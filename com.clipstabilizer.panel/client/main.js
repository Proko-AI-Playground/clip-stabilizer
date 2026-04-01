/**
 * Main controller for Clip Stabilizer CEP extension.
 * Flow: Stabilize (one-click: load edit + compare + apply)
 */

(function() {
    'use strict';

    var csInterface = new CSInterface();
    var path = require('path');
    var childProcess = require('child_process');
    var fs = require('fs');
    var os = require('os');

    // UI Elements
    var btnStabilize = document.getElementById('btn-stabilize');
    var btnUndo = document.getElementById('btn-undo');
    var statusArea = document.getElementById('status-area');
    var statusIcon = document.getElementById('status-icon');
    var statusText = document.getElementById('status-text');
    var statusDetail = document.getElementById('status-detail');
    var resultArea = document.getElementById('result-area');
    var errorArea = document.getElementById('error-area');
    var errorText = document.getElementById('error-text');
    var canvas1 = document.getElementById('canvas1');
    var canvas2 = document.getElementById('canvas2');

    // State
    var lastAppliedCorrection = null;

    // ---- Helpers ----

    function setStatus(text, detail) {
        statusArea.classList.remove('hidden');
        resultArea.classList.add('hidden');
        errorArea.classList.add('hidden');
        statusIcon.className = 'spinner';
        statusIcon.textContent = '';
        statusText.textContent = text;
        statusDetail.textContent = detail || '';
    }

    function setDone(text) {
        statusIcon.className = 'status-icon-done';
        statusIcon.textContent = '\u2713';
        statusText.textContent = text;
    }

    function setError(text) {
        statusArea.classList.add('hidden');
        resultArea.classList.add('hidden');
        errorArea.classList.remove('hidden');
        errorText.textContent = text;
    }

    function showResult(result) {
        resultArea.classList.remove('hidden');
        document.getElementById('result-pos-x').textContent = result.posX.toFixed(1);
        document.getElementById('result-pos-y').textContent = result.posY.toFixed(1);
        document.getElementById('result-rotation').textContent = result.rotation.toFixed(2) + '\u00B0';
        document.getElementById('result-matches').textContent =
            result.inlierCount + ' / ' + result.totalMatches + ' inliers';
    }

    function evalScript(script) {
        return new Promise(function(resolve, reject) {
            csInterface.evalScript(script, function(result) {
                if (result === 'EvalScript error.') {
                    reject(new Error(
                        'ExtendScript failed: "' + script.substring(0, 80) + '"\n\n' +
                        'Re-run install.bat and restart Premiere Pro.'
                    ));
                } else if (result === 'undefined') {
                    reject(new Error('ExtendScript returned undefined for: ' + script.substring(0, 80)));
                } else {
                    resolve(result);
                }
            });
        });
    }

    function getTempDir() {
        var dir = path.join(os.tmpdir(), 'clip-stabilizer');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    function extractFrame(ffmpegPath, mediaPath, timeSeconds, outputPath) {
        return new Promise(function(resolve, reject) {
            var cmd = '"' + ffmpegPath + '"' +
                ' -ss ' + timeSeconds.toFixed(6) +
                ' -i "' + mediaPath.replace(/\\/g, '/') + '"' +
                ' -frames:v 1 -q:v 2 -y' +
                ' "' + outputPath.replace(/\\/g, '/') + '"';

            childProcess.exec(cmd, { timeout: 30000 }, function(error, stdout, stderr) {
                if (error) {
                    reject(new Error('FFmpeg error: ' + (stderr || error.message)));
                } else if (!fs.existsSync(outputPath)) {
                    reject(new Error('FFmpeg did not produce output file'));
                } else {
                    resolve(outputPath);
                }
            });
        });
    }

    function loadImage(imagePath) {
        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() { resolve(img); };
            img.onerror = function() { reject(new Error('Failed to load image: ' + imagePath)); };
            img.src = 'file:///' + imagePath.replace(/\\/g, '/') + '?t=' + Date.now();
        });
    }

    function drawImageToCanvas(img, canvas) {
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
    }

    // ---- Stabilize (load + compare + apply in one step) ----

    async function stabilize() {
        btnStabilize.disabled = true;
        resultArea.classList.add('hidden');
        errorArea.classList.add('hidden');
        lastAppliedCorrection = null;

        try {
            // Step 1: Get edit point info
            setStatus('Analyzing timeline...', 'Finding edit point near playhead');

            var infoJson = await evalScript('getEditPointInfo()');
            var editInfo;
            try {
                editInfo = JSON.parse(infoJson);
            } catch (e) {
                throw new Error('Failed to parse timeline info.\n\nRaw: ' + infoJson);
            }

            if (editInfo.error) {
                throw new Error(editInfo.error);
            }

            var ffmpegPath = document.getElementById('ffmpeg-path').value || 'ffmpeg';
            var tempDir = getTempDir();
            var frame1Path = path.join(tempDir, 'frame1.jpg');
            var frame2Path = path.join(tempDir, 'frame2.jpg');

            var time1 = parseFloat(editInfo.clip1LastFrameSeconds);
            var time2 = parseFloat(editInfo.clip2FirstFrameSeconds);

            if (isNaN(time1) || isNaN(time2)) {
                throw new Error('Invalid timestamps.\ntime1=' + editInfo.clip1LastFrameSeconds +
                    ' time2=' + editInfo.clip2FirstFrameSeconds);
            }

            // Step 2: Extract both frames
            setStatus('Extracting frames...', '');
            await Promise.all([
                extractFrame(ffmpegPath, editInfo.clip1MediaPath, time1, frame1Path),
                extractFrame(ffmpegPath, editInfo.clip2MediaPath, time2, frame2Path)
            ]);

            // Step 3: Load images
            var images = await Promise.all([loadImage(frame1Path), loadImage(frame2Path)]);
            drawImageToCanvas(images[0], canvas1);
            drawImageToCanvas(images[1], canvas2);

            // Step 4: Compare frames
            setStatus('Comparing frames...', '');
            await new Promise(function(resolve) { setTimeout(resolve, 50); });

            var searchRadius = parseInt(document.getElementById('search-radius').value) || 100;
            var result = ImageProcessor.compare(canvas1, canvas2, searchRadius);

            if (result.error) {
                throw new Error(result.error);
            }

            // Step 5: Apply correction
            setStatus('Applying correction...', '');

            var sourceW = canvas1.width;
            var applyScript = 'applyCorrection(' +
                result.tx.toFixed(6) + ', ' +
                result.ty.toFixed(6) + ', ' +
                result.rotation.toFixed(6) + ', ' +
                sourceW + ')';

            var applyResultJson = await evalScript(applyScript);
            var applyResult;
            try {
                applyResult = JSON.parse(applyResultJson);
            } catch (e) {
                throw new Error('Failed to parse apply result: ' + applyResultJson);
            }

            if (applyResult.error) {
                throw new Error('Apply failed: ' + applyResult.error);
            }

            setDone('Stabilization applied');
            statusDetail.textContent =
                'Detected: tx=' + result.tx.toFixed(1) + ' ty=' + result.ty.toFixed(1) + ' rot=' + result.rotation.toFixed(2) + '\u00B0';

            showResult({
                posX: applyResult.clip2Pos[0],
                posY: applyResult.clip2Pos[1],
                rotation: applyResult.clip2Rot,
                inlierCount: result.inlierCount,
                totalMatches: result.totalMatches
            });

            lastAppliedCorrection = true;
            btnUndo.style.display = 'inline-block';

        } catch (err) {
            setError(err.message);
        }

        btnStabilize.disabled = false;
    }

    // ---- Undo ----

    async function undoCorrection() {
        if (!lastAppliedCorrection) return;
        try {
            await evalScript('undoCorrection()');
            resultArea.classList.add('hidden');
            statusArea.classList.add('hidden');
            lastAppliedCorrection = null;
            btnUndo.style.display = 'none';
        } catch (err) {
            setError('Undo failed: ' + err.message);
        }
    }

    // ---- Event Listeners ----

    btnStabilize.addEventListener('click', stabilize);
    btnUndo.addEventListener('click', undoCorrection);

    // ---- Nudge Controls ----

    var POS_STEP = 0.5;   // pixels per click
    var ROT_STEP = 0.05;  // degrees per click

    document.querySelectorAll('.btn-nudge').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var prop = btn.dataset.prop;
            var dir = parseInt(btn.dataset.dir);

            if (prop === 'pos') {
                var axis = btn.dataset.axis;
                var dx = axis === 'x' ? dir * POS_STEP : 0;
                var dy = axis === 'y' ? dir * POS_STEP : 0;
                evalScript('nudgeClip2("pos",' + dx + ',' + dy + ')').then(function(json) {
                    var r = JSON.parse(json);
                    if (r.success) {
                        document.getElementById('result-pos-x').textContent = r.posX.toFixed(1);
                        document.getElementById('result-pos-y').textContent = r.posY.toFixed(1);
                    }
                });
            } else if (prop === 'rot') {
                var delta = dir * ROT_STEP;
                evalScript('nudgeClip2("rot",' + delta + ',0)').then(function(json) {
                    var r = JSON.parse(json);
                    if (r.success) {
                        document.getElementById('result-rotation').textContent = r.rotation.toFixed(2) + '\u00B0';
                    }
                });
            }
        });
    });

    // Persist settings
    document.getElementById('search-radius').addEventListener('change', function() {
        localStorage.setItem('clipstab_searchRadius', this.value);
    });
    document.getElementById('ffmpeg-path').addEventListener('change', function() {
        localStorage.setItem('clipstab_ffmpegPath', this.value);
    });
    var savedRadius = localStorage.getItem('clipstab_searchRadius');
    if (savedRadius) document.getElementById('search-radius').value = savedRadius;
    var savedFFmpeg = localStorage.getItem('clipstab_ffmpegPath');
    if (savedFFmpeg) document.getElementById('ffmpeg-path').value = savedFFmpeg;

})();
