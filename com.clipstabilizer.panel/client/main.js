/**
 * Main controller for Clip Stabilizer CEP extension.
 * Flow: Load Edit -> Preview frame + draw ROI -> Stabilize
 */

(function() {
    'use strict';

    var csInterface = new CSInterface();
    var path = require('path');
    var childProcess = require('child_process');
    var fs = require('fs');
    var os = require('os');

    // UI Elements
    var btnLoad = document.getElementById('btn-load');
    var btnStabilize = document.getElementById('btn-stabilize');
    var btnClearRoi = document.getElementById('btn-clear-roi');
    var btnUndo = document.getElementById('btn-undo');
    var previewArea = document.getElementById('preview-area');
    var previewCanvas = document.getElementById('preview-canvas');
    var previewCtx = previewCanvas.getContext('2d');
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
    var editInfo = null;           // Stored info from getEditPointInfo
    var previewImage = null;       // Image object for frame 1
    var previewScale = 1;          // Scale from original to preview size
    var roi = null;                // { x, y, w, h } in ORIGINAL image pixels
    var roiDraw = null;            // In-progress drawing state
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

    // ---- Preview & ROI Drawing ----

    function renderPreview() {
        if (!previewImage) return;

        // Fit to panel width
        var panelWidth = previewCanvas.parentElement.clientWidth;
        previewScale = panelWidth / previewImage.width;
        previewCanvas.width = panelWidth;
        previewCanvas.height = Math.round(previewImage.height * previewScale);

        previewCtx.drawImage(previewImage, 0, 0, previewCanvas.width, previewCanvas.height);

        // Draw ROI if exists
        if (roi) {
            drawRoiRect(roi.x * previewScale, roi.y * previewScale,
                        roi.w * previewScale, roi.h * previewScale);
        }
    }

    function drawRoiRect(x, y, w, h) {
        previewCtx.strokeStyle = '#3d9ae8';
        previewCtx.lineWidth = 2;
        previewCtx.setLineDash([6, 3]);
        previewCtx.strokeRect(x, y, w, h);
        previewCtx.setLineDash([]);

        // Semi-transparent fill
        previewCtx.fillStyle = 'rgba(61, 154, 232, 0.1)';
        previewCtx.fillRect(x, y, w, h);
    }

    function getCanvasPos(e) {
        var rect = previewCanvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    previewCanvas.addEventListener('mousedown', function(e) {
        var pos = getCanvasPos(e);
        roiDraw = { startX: pos.x, startY: pos.y };
        roi = null;
    });

    previewCanvas.addEventListener('mousemove', function(e) {
        if (!roiDraw) return;
        var pos = getCanvasPos(e);

        // Redraw preview + current selection
        renderPreview();
        var x = Math.min(roiDraw.startX, pos.x);
        var y = Math.min(roiDraw.startY, pos.y);
        var w = Math.abs(pos.x - roiDraw.startX);
        var h = Math.abs(pos.y - roiDraw.startY);
        drawRoiRect(x, y, w, h);
    });

    previewCanvas.addEventListener('mouseup', function(e) {
        if (!roiDraw) return;
        var pos = getCanvasPos(e);

        var x = Math.min(roiDraw.startX, pos.x);
        var y = Math.min(roiDraw.startY, pos.y);
        var w = Math.abs(pos.x - roiDraw.startX);
        var h = Math.abs(pos.y - roiDraw.startY);

        roiDraw = null;

        // Minimum size check (at least 20px in preview)
        if (w < 20 || h < 20) {
            roi = null;
            renderPreview();
            return;
        }

        // Convert to original image coordinates
        roi = {
            x: Math.round(x / previewScale),
            y: Math.round(y / previewScale),
            w: Math.round(w / previewScale),
            h: Math.round(h / previewScale)
        };

        renderPreview();
    });

    previewCanvas.addEventListener('mouseleave', function() {
        if (roiDraw) {
            roiDraw = null;
            renderPreview();
        }
    });

    btnClearRoi.addEventListener('click', function() {
        roi = null;
        renderPreview();
    });

    // ---- Step 1: Load Edit ----

    async function loadEdit() {
        btnLoad.disabled = true;
        previewArea.classList.add('hidden');
        resultArea.classList.add('hidden');
        errorArea.classList.add('hidden');
        roi = null;
        lastAppliedCorrection = null;

        try {
            setStatus('Analyzing timeline...', 'Finding edit point near playhead');

            var infoJson = await evalScript('getEditPointInfo()');
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

            // Extract both frames
            setStatus('Extracting frames...', 'Clip 1: last frame');
            await extractFrame(ffmpegPath, editInfo.clip1MediaPath, time1, frame1Path);

            setStatus('Extracting frames...', 'Clip 2: first frame');
            await extractFrame(ffmpegPath, editInfo.clip2MediaPath, time2, frame2Path);

            // Load images
            setStatus('Loading frames...', '');
            previewImage = await loadImage(frame1Path);
            var img2 = await loadImage(frame2Path);

            drawImageToCanvas(previewImage, canvas1);
            drawImageToCanvas(img2, canvas2);

            // Show preview
            statusArea.classList.add('hidden');
            previewArea.classList.remove('hidden');
            renderPreview();

        } catch (err) {
            setError(err.message);
        }

        btnLoad.disabled = false;
    }

    // ---- Step 2: Stabilize with ROI ----

    async function stabilize() {
        btnStabilize.disabled = true;

        try {
            setStatus('Comparing frames...', roi
                ? 'Feature region: ' + roi.w + 'x' + roi.h + 'px (refinement uses full frame)'
                : 'Using full frame');

            await new Promise(function(resolve) { setTimeout(resolve, 50); });

            var searchRadius = parseInt(document.getElementById('search-radius').value) || 100;
            var result = ImageProcessor.compare(canvas1, canvas2, searchRadius, roi);

            if (result.error) {
                throw new Error(result.error);
            }

            var rotation = result.rotation;

            // Send raw source pixel offsets to ExtendScript
            setStatus('Applying correction...', '');

            var sourceW = canvas1.width;
            var applyScript = 'applyCorrection(' +
                result.tx.toFixed(6) + ', ' +
                result.ty.toFixed(6) + ', ' +
                rotation.toFixed(6) + ', ' +
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
                'Clip 1: (' + applyResult.clip1Pos[0].toFixed(1) + ', ' + applyResult.clip1Pos[1].toFixed(1) + ') rot=' + applyResult.clip1Rot.toFixed(2) + '\u00B0' +
                '\nDetected: tx=' + result.tx.toFixed(1) + ' ty=' + result.ty.toFixed(1) + ' rot=' + result.rotation.toFixed(2) + '\u00B0' +
                '\nClip 2: (' + applyResult.clip2Pos[0].toFixed(1) + ', ' + applyResult.clip2Pos[1].toFixed(1) + ') rot=' + applyResult.clip2Rot.toFixed(2) + '\u00B0' +
                '\nFormat: ' + applyResult.posFormat + ' | raw1=[' + applyResult.rawClip1[0].toFixed(6) + ',' + applyResult.rawClip1[1].toFixed(6) + ']';

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

    btnLoad.addEventListener('click', loadEdit);
    btnStabilize.addEventListener('click', stabilize);
    btnUndo.addEventListener('click', undoCorrection);

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
