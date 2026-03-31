/**
 * ExtendScript for Clip Stabilizer - Premiere Pro API interaction.
 */

// Polyfill JSON for ExtendScript
if (typeof JSON === 'undefined') {
    JSON = {};
    JSON.stringify = function(obj) {
        if (obj === null) return 'null';
        if (typeof obj === 'string') return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
        if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
        if (obj instanceof Array) {
            var arr = [];
            for (var i = 0; i < obj.length; i++) arr.push(JSON.stringify(obj[i]));
            return '[' + arr.join(',') + ']';
        }
        if (typeof obj === 'object') {
            var pairs = [];
            for (var k in obj) {
                if (obj.hasOwnProperty(k)) {
                    pairs.push('"' + k + '":' + JSON.stringify(obj[k]));
                }
            }
            return '{' + pairs.join(',') + '}';
        }
        return 'null';
    };
}

var TICKS_PER_SECOND = 254016000000;

function ticksToSeconds(ticksStr) {
    return parseFloat(ticksStr) / TICKS_PER_SECOND;
}

/**
 * Helper: get Motion component from a clip
 */
function getMotionComponent(clip) {
    for (var i = 0; i < clip.components.numItems; i++) {
        if (clip.components[i].displayName === 'Motion') {
            return clip.components[i];
        }
    }
    return null;
}

/**
 * Helper: read motion property by name
 */
function getMotionProp(motionComp, propName) {
    for (var p = 0; p < motionComp.properties.numItems; p++) {
        if (motionComp.properties[p].displayName === propName) {
            return motionComp.properties[p];
        }
    }
    return null;
}

/**
 * Find the edit point near the playhead and return info about the two adjacent clips.
 */
function getEditPointInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) {
            return JSON.stringify({ error: 'No active sequence. Please open a sequence first.' });
        }

        var currentTimeTicks = parseFloat(seq.getPlayerPosition().ticks);

        var bestClip1 = null;
        var bestClip2 = null;
        var bestDistance = Infinity;
        var bestTrackIdx = -1;
        var bestClip1Idx = -1;
        var bestClip2Idx = -1;

        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            if (track.clips.numItems < 2) continue;

            for (var c = 0; c < track.clips.numItems - 1; c++) {
                var c1 = track.clips[c];
                var c2 = track.clips[c + 1];

                var c1EndTicks = parseFloat(c1.end.ticks);
                var c2StartTicks = parseFloat(c2.start.ticks);
                var gap = Math.abs(c2StartTicks - c1EndTicks);
                if (gap > 0.15 * TICKS_PER_SECOND) continue;

                var distance = Math.abs(currentTimeTicks - c1EndTicks);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestClip1 = c1;
                    bestClip2 = c2;
                    bestTrackIdx = t;
                    bestClip1Idx = c;
                    bestClip2Idx = c + 1;
                }
            }
        }

        if (!bestClip1 || !bestClip2) {
            return JSON.stringify({ error: 'No adjacent clips found near the playhead. Place the playhead on an edit point between two clips.' });
        }

        var clip1MediaPath = bestClip1.projectItem.getMediaPath();
        var clip2MediaPath = bestClip2.projectItem.getMediaPath();
        if (!clip1MediaPath || !clip2MediaPath) {
            return JSON.stringify({ error: 'Could not get media file paths. Make sure clips are linked to source media.' });
        }

        var clip1LastFrameSeconds = ticksToSeconds(bestClip1.outPoint.ticks) - 0.01;
        if (clip1LastFrameSeconds < 0) clip1LastFrameSeconds = 0;
        var clip2FirstFrameSeconds = ticksToSeconds(bestClip2.inPoint.ticks);

        // Store BOTH clip references for applyCorrection
        $.global.stab_trackIdx = bestTrackIdx;
        $.global.stab_clip1Idx = bestClip1Idx;
        $.global.stab_clip2Idx = bestClip2Idx;

        return JSON.stringify({
            clip1MediaPath: clip1MediaPath,
            clip2MediaPath: clip2MediaPath,
            clip1LastFrameSeconds: clip1LastFrameSeconds,
            clip2FirstFrameSeconds: clip2FirstFrameSeconds,
            sequenceWidth: seq.frameSizeHorizontal,
            sequenceHeight: seq.frameSizeVertical
        });

    } catch (e) {
        return JSON.stringify({ error: 'ExtendScript error: ' + e.message + ' (line ' + e.line + ')' });
    }
}

/**
 * Apply motion correction to clip 2 based on detected offset in SOURCE PIXELS.
 * All coordinate conversion happens here - no guessing needed on the JS side.
 *
 * @param {number} srcOffsetX - Detected X offset in source image pixels
 * @param {number} srcOffsetY - Detected Y offset in source image pixels
 * @param {number} srcRotation - Detected rotation in degrees
 * @param {number} sourceWidth - Width of the source frame (from ffmpeg extraction)
 */
function applyCorrection(srcOffsetX, srcOffsetY, srcRotation, sourceWidth) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: 'no active sequence' });

        var trackIdx = $.global.stab_trackIdx;
        var clip1Idx = $.global.stab_clip1Idx;
        var clip2Idx = $.global.stab_clip2Idx;

        var track = seq.videoTracks[trackIdx];
        if (!track) return JSON.stringify({ error: 'track not found' });

        var clip1 = track.clips[clip1Idx];
        var clip2 = track.clips[clip2Idx];
        if (!clip1 || !clip2) return JSON.stringify({ error: 'clip not found' });

        var motion1 = getMotionComponent(clip1);
        var motion2 = getMotionComponent(clip2);
        if (!motion1 || !motion2) return JSON.stringify({ error: 'Motion component not found' });

        // Read clip 1's current values (raw API format)
        var pos1Prop = getMotionProp(motion1, 'Position');
        var rot1Prop = getMotionProp(motion1, 'Rotation');
        var scale1Prop = getMotionProp(motion1, 'Scale');

        var pos1 = pos1Prop.getValue();   // [rawX, rawY] - format TBD
        var rot1 = rot1Prop.getValue();    // degrees
        var scale1 = scale1Prop.getValue(); // percentage

        // Save clip 2's original values for undo
        var pos2Prop = getMotionProp(motion2, 'Position');
        var rot2Prop = getMotionProp(motion2, 'Rotation');
        var pos2orig = pos2Prop.getValue();
        var rot2orig = rot2Prop.getValue();
        $.global.stab_undo_pos = pos2orig;
        $.global.stab_undo_rot = rot2orig;

        // Determine what units Position uses by comparing with sequence size
        var seqW = seq.frameSizeHorizontal;
        var seqH = seq.frameSizeVertical;
        var posIsNormalized = (pos1[0] <= 2.0 && pos1[1] <= 2.0);

        // srcOffset is NCC offset (rotation around frame center model).
        // Correct formula: pos2 = pos1 - scale * R(-θ) * nccOffset
        // R(-θ) accounts for rotation changing the effective position.
        var screenScale = scale1 / 100.0;
        var rotRad = srcRotation * Math.PI / 180;
        var cosR = Math.cos(rotRad);
        var sinR = Math.sin(rotRad);

        // Apply R(-θ) to the NCC offset: rotated offset in source pixels
        var rotOffX = cosR * srcOffsetX + sinR * srcOffsetY;
        var rotOffY = -sinR * srcOffsetX + cosR * srcOffsetY;

        var offsetX, offsetY;
        if (posIsNormalized) {
            offsetX = rotOffX * screenScale / seqW;
            offsetY = rotOffY * screenScale / seqH;
        } else {
            offsetX = rotOffX * screenScale;
            offsetY = rotOffY * screenScale;
        }

        // Clip 2 correction
        var newPosX = pos1[0] - offsetX;
        var newPosY = pos1[1] - offsetY;
        var newRot = rot1 - srcRotation;

        // Apply to clip 2
        pos2Prop.setValue([newPosX, newPosY], true);
        rot2Prop.setValue(newRot, true);

        // Read back to confirm
        var readback = pos2Prop.getValue();

        // Convert to pixel values for display
        var displayX, displayY;
        if (posIsNormalized) {
            displayX = newPosX * seqW;
            displayY = newPosY * seqH;
        } else {
            displayX = newPosX;
            displayY = newPosY;
        }

        return JSON.stringify({
            success: true,
            clip1Pos: [posIsNormalized ? pos1[0] * seqW : pos1[0], posIsNormalized ? pos1[1] * seqH : pos1[1]],
            clip1Rot: rot1,
            clip1Scale: scale1,
            clip2Pos: [displayX, displayY],
            clip2Rot: newRot,
            posFormat: posIsNormalized ? 'normalized' : 'pixels',
            rawClip1: [pos1[0], pos1[1]],
            offset: [offsetX, offsetY],
            readback: [readback[0], readback[1]]
        });

    } catch (e) {
        return JSON.stringify({ error: e.message + ' (line ' + e.line + ')' });
    }
}

/**
 * Undo: restore clip 2's original position and rotation.
 */
function undoCorrection() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: 'no active sequence' });

        var track = seq.videoTracks[$.global.stab_trackIdx];
        var clip2 = track.clips[$.global.stab_clip2Idx];
        var motion2 = getMotionComponent(clip2);

        var pos2Prop = getMotionProp(motion2, 'Position');
        var rot2Prop = getMotionProp(motion2, 'Rotation');

        pos2Prop.setValue($.global.stab_undo_pos, true);
        rot2Prop.setValue($.global.stab_undo_rot, true);

        return JSON.stringify({ success: true });
    } catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
