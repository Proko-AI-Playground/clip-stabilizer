/**
 * Image processing module for Clip Stabilizer.
 * Detects translation, rotation, and scale between two frames
 * using feature matching (FAST corners + patch NCC + RANSAC).
 */

var ImageProcessor = (function() {
    'use strict';

    var WORK_WIDTH = 1920;
    var WORK_HEIGHT = 1080;

    // ---- Grayscale ----
    function toGrayscale(imageData, width, height) {
        var gray = new Float32Array(width * height);
        var data = imageData.data;
        for (var i = 0; i < width * height; i++) {
            var idx = i * 4;
            gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        }
        return gray;
    }

    // ---- Gaussian Blur (5x5, sigma ~1.0) ----
    function gaussianBlur(gray, w, h) {
        var kernel = [1, 4, 6, 4, 1, 4, 16, 24, 16, 4, 6, 24, 36, 24, 6, 4, 16, 24, 16, 4, 1, 4, 6, 4, 1];
        var kSum = 256;
        var out = new Float32Array(w * h);
        for (var y = 2; y < h - 2; y++) {
            for (var x = 2; x < w - 2; x++) {
                var sum = 0;
                for (var ky = -2; ky <= 2; ky++) {
                    for (var kx = -2; kx <= 2; kx++) {
                        sum += gray[(y + ky) * w + (x + kx)] * kernel[(ky + 2) * 5 + (kx + 2)];
                    }
                }
                out[y * w + x] = sum / kSum;
            }
        }
        return out;
    }

    // ---- FAST-9 Corner Detection ----
    var CIRCLE_OFFSETS = [
        [0, -3], [1, -3], [2, -2], [3, -1],
        [3, 0], [3, 1], [2, 2], [1, 3],
        [0, 3], [-1, 3], [-2, 2], [-3, 1],
        [-3, 0], [-3, -1], [-2, -2], [-1, -3]
    ];

    function detectFAST(gray, w, h, threshold) {
        threshold = threshold || 30;
        var corners = [];
        var margin = 4;

        for (var y = margin; y < h - margin; y++) {
            for (var x = margin; x < w - margin; x++) {
                var center = gray[y * w + x];
                var cb = center - threshold;
                var ct = center + threshold;

                // Quick reject: check pixels 0, 4, 8, 12
                var p0 = gray[(y + CIRCLE_OFFSETS[0][1]) * w + (x + CIRCLE_OFFSETS[0][0])];
                var p4 = gray[(y + CIRCLE_OFFSETS[4][1]) * w + (x + CIRCLE_OFFSETS[4][0])];
                var p8 = gray[(y + CIRCLE_OFFSETS[8][1]) * w + (x + CIRCLE_OFFSETS[8][0])];
                var p12 = gray[(y + CIRCLE_OFFSETS[12][1]) * w + (x + CIRCLE_OFFSETS[12][0])];

                var nBright = (p0 > ct ? 1 : 0) + (p4 > ct ? 1 : 0) + (p8 > ct ? 1 : 0) + (p12 > ct ? 1 : 0);
                var nDark = (p0 < cb ? 1 : 0) + (p4 < cb ? 1 : 0) + (p8 < cb ? 1 : 0) + (p12 < cb ? 1 : 0);

                if (nBright < 3 && nDark < 3) continue;

                // Full check: 9 contiguous
                var vals = new Array(16);
                for (var i = 0; i < 16; i++) {
                    vals[i] = gray[(y + CIRCLE_OFFSETS[i][1]) * w + (x + CIRCLE_OFFSETS[i][0])];
                }

                var isCorner = false;
                // Check bright
                if (nBright >= 3) {
                    isCorner = checkContiguous(vals, ct, true);
                }
                // Check dark
                if (!isCorner && nDark >= 3) {
                    isCorner = checkContiguous(vals, cb, false);
                }

                if (isCorner) {
                    // Corner score: sum of absolute differences
                    var score = 0;
                    for (var i = 0; i < 16; i++) {
                        score += Math.abs(vals[i] - center);
                    }
                    corners.push({ x: x, y: y, score: score });
                }
            }
        }

        return corners;
    }

    function checkContiguous(vals, thresh, bright) {
        // Check if there are 9 contiguous pixels that pass the threshold
        // Duplicate the array to handle wrap-around
        for (var start = 0; start < 16; start++) {
            var count = 0;
            for (var j = 0; j < 16; j++) {
                var idx = (start + j) % 16;
                var pass = bright ? (vals[idx] > thresh) : (vals[idx] < thresh);
                if (pass) {
                    count++;
                    if (count >= 9) return true;
                } else {
                    break;
                }
            }
        }
        return false;
    }

    // ---- Non-Maximum Suppression ----
    function nonMaxSuppression(corners, w, h, radius) {
        radius = radius || 8;
        // Sort by score descending
        corners.sort(function(a, b) { return b.score - a.score; });

        var suppressed = new Uint8Array(corners.length);
        var result = [];

        for (var i = 0; i < corners.length; i++) {
            if (suppressed[i]) continue;
            result.push(corners[i]);
            // Suppress nearby corners with lower score
            for (var j = i + 1; j < corners.length; j++) {
                if (suppressed[j]) continue;
                var dx = corners[i].x - corners[j].x;
                var dy = corners[i].y - corners[j].y;
                if (dx * dx + dy * dy < radius * radius) {
                    suppressed[j] = 1;
                }
            }
        }

        return result;
    }

    // ---- Patch Extraction & NCC ----
    var PATCH_SIZE = 31;
    var HALF_PATCH = 15;

    function extractPatch(gray, w, h, cx, cy) {
        var patch = new Float32Array(PATCH_SIZE * PATCH_SIZE);
        var sum = 0;
        var count = 0;
        for (var dy = -HALF_PATCH; dy <= HALF_PATCH; dy++) {
            for (var dx = -HALF_PATCH; dx <= HALF_PATCH; dx++) {
                var px = cx + dx;
                var py = cy + dy;
                if (px < 0 || px >= w || py < 0 || py >= h) {
                    patch[count] = 0;
                } else {
                    patch[count] = gray[py * w + px];
                }
                sum += patch[count];
                count++;
            }
        }
        // Normalize: zero mean, unit variance
        var mean = sum / count;
        var variance = 0;
        for (var i = 0; i < count; i++) {
            patch[i] -= mean;
            variance += patch[i] * patch[i];
        }
        var std = Math.sqrt(variance / count);
        if (std > 1e-6) {
            for (var i = 0; i < count; i++) {
                patch[i] /= std;
            }
        }
        return patch;
    }

    function ncc(patch1, patch2) {
        var sum = 0;
        var len = patch1.length;
        for (var i = 0; i < len; i++) {
            sum += patch1[i] * patch2[i];
        }
        return sum / len;
    }

    // ---- Feature Matching (one direction) ----
    function matchFeaturesOneWay(gray1, w1, h1, corners1, patches1, gray2, w2, h2, corners2, patches2, searchRadius) {
        var matches = [];
        var maxCorners = Math.min(corners1.length, 400);

        for (var i = 0; i < maxCorners; i++) {
            var c1 = corners1[i];
            var patch1 = patches1[i];

            var bestScore = -1;
            var secondBestScore = -1;
            var bestIdx = -1;

            for (var j = 0; j < corners2.length; j++) {
                var c2 = corners2[j];
                var dx = c1.x - c2.x;
                var dy = c1.y - c2.y;
                if (dx * dx + dy * dy > searchRadius * searchRadius) continue;

                var score = ncc(patch1, patches2[j]);
                if (score > bestScore) {
                    secondBestScore = bestScore;
                    bestScore = score;
                    bestIdx = j;
                } else if (score > secondBestScore) {
                    secondBestScore = score;
                }
            }

            // Ratio test: best match must be significantly better
            if (bestIdx >= 0 && bestScore > 0.7) {
                if (secondBestScore < 0 || bestScore > secondBestScore * 1.3) {
                    matches.push({
                        idx1: i, idx2: bestIdx,
                        x1: c1.x, y1: c1.y,
                        x2: corners2[bestIdx].x, y2: corners2[bestIdx].y,
                        score: bestScore
                    });
                }
            }
        }

        return matches;
    }

    // ---- Feature Matching with Forward-Backward Consistency ----
    function matchFeatures(gray1, w1, h1, corners1, gray2, w2, h2, corners2, searchRadius) {
        // Pre-extract all patches
        var patches1 = [];
        for (var i = 0; i < corners1.length; i++) {
            patches1[i] = extractPatch(gray1, w1, h1, corners1[i].x, corners1[i].y);
        }
        var patches2 = [];
        for (var j = 0; j < corners2.length; j++) {
            patches2[j] = extractPatch(gray2, w2, h2, corners2[j].x, corners2[j].y);
        }

        // Forward: 1 -> 2
        var forward = matchFeaturesOneWay(gray1, w1, h1, corners1, patches1, gray2, w2, h2, corners2, patches2, searchRadius);
        // Backward: 2 -> 1
        var backward = matchFeaturesOneWay(gray2, w2, h2, corners2, patches2, gray1, w1, h1, corners1, patches1, searchRadius);

        // Build reverse lookup: for each corner2 index, which corner1 index did backward pick?
        var backwardMap = {};
        for (var k = 0; k < backward.length; k++) {
            backwardMap[backward[k].idx1] = backward[k].idx2;  // idx1 is in corners2, idx2 is in corners1
        }

        // Keep only consistent matches: forward(i)=j AND backward(j)=i
        var consistent = [];
        for (var k = 0; k < forward.length; k++) {
            var fwd = forward[k];
            if (backwardMap[fwd.idx2] === fwd.idx1) {
                consistent.push({
                    x1: fwd.x1, y1: fwd.y1,
                    x2: fwd.x2, y2: fwd.y2,
                    score: fwd.score
                });
            }
        }

        return consistent;
    }

    // ---- Similarity Transform Estimation ----
    // Transform: p2 = s * R(theta) * p1 + t
    // Parameterized as: x2 = a*x1 - b*y1 + tx,  y2 = b*x1 + a*y1 + ty
    // where a = s*cos(theta), b = s*sin(theta)

    function estimateTransformFromPairs(pairs) {
        // Solve using least squares
        // [x1  -y1  1  0] [a ]   [x2]
        // [y1   x1  0  1] [b ] = [y2]
        //                  [tx]
        //                  [ty]
        var n = pairs.length;
        if (n < 2) return null;

        // Build normal equations: A^T A x = A^T b
        var ATA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 4x4
        var ATb = [0, 0, 0, 0]; // 4x1

        for (var i = 0; i < n; i++) {
            var x1 = pairs[i].x1, y1 = pairs[i].y1;
            var x2 = pairs[i].x2, y2 = pairs[i].y2;

            // Row 1: [x1, -y1, 1, 0]
            // Row 2: [y1,  x1, 0, 1]
            var r1 = [x1, -y1, 1, 0];
            var r2 = [y1, x1, 0, 1];

            for (var j = 0; j < 4; j++) {
                for (var k = 0; k < 4; k++) {
                    ATA[j * 4 + k] += r1[j] * r1[k] + r2[j] * r2[k];
                }
                ATb[j] += r1[j] * x2 + r2[j] * y2;
            }
        }

        // Solve 4x4 system using Gaussian elimination
        var result = solve4x4(ATA, ATb);
        if (!result) return null;

        var a = result[0], b = result[1], tx = result[2], ty = result[3];
        var scale = Math.sqrt(a * a + b * b);
        var rotation = Math.atan2(b, a) * 180 / Math.PI;

        return { a: a, b: b, tx: tx, ty: ty, scale: scale, rotation: rotation };
    }

    function solve4x4(A, b) {
        // Augmented matrix
        var M = [];
        for (var i = 0; i < 4; i++) {
            M[i] = [];
            for (var j = 0; j < 4; j++) {
                M[i][j] = A[i * 4 + j];
            }
            M[i][4] = b[i];
        }

        // Forward elimination with partial pivoting
        for (var col = 0; col < 4; col++) {
            var maxVal = Math.abs(M[col][col]);
            var maxRow = col;
            for (var row = col + 1; row < 4; row++) {
                if (Math.abs(M[row][col]) > maxVal) {
                    maxVal = Math.abs(M[row][col]);
                    maxRow = row;
                }
            }
            if (maxVal < 1e-10) return null;

            // Swap rows
            var tmp = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp;

            // Eliminate
            for (var row = col + 1; row < 4; row++) {
                var factor = M[row][col] / M[col][col];
                for (var j = col; j <= 4; j++) {
                    M[row][j] -= factor * M[col][j];
                }
            }
        }

        // Back substitution
        var x = [0, 0, 0, 0];
        for (var i = 3; i >= 0; i--) {
            x[i] = M[i][4];
            for (var j = i + 1; j < 4; j++) {
                x[i] -= M[i][j] * x[j];
            }
            x[i] /= M[i][i];
        }
        return x;
    }

    // ---- RANSAC ----
    function ransacSimilarityTransform(matches, iterations, inlierThreshold) {
        iterations = iterations || 500;
        inlierThreshold = inlierThreshold || 5.0;

        if (matches.length < 2) return null;

        var bestModel = null;
        var bestInlierCount = 0;
        var bestInliers = [];

        for (var iter = 0; iter < iterations; iter++) {
            // Random sample of 2 matches
            var idx1 = Math.floor(Math.random() * matches.length);
            var idx2 = Math.floor(Math.random() * matches.length);
            if (idx1 === idx2) continue;

            var sample = [matches[idx1], matches[idx2]];
            var model = estimateTransformFromPairs(sample);
            if (!model) continue;

            // Count inliers
            var inliers = [];
            for (var i = 0; i < matches.length; i++) {
                var m = matches[i];
                var px = model.a * m.x1 - model.b * m.y1 + model.tx;
                var py = model.b * m.x1 + model.a * m.y1 + model.ty;
                var err = Math.sqrt((px - m.x2) * (px - m.x2) + (py - m.y2) * (py - m.y2));
                if (err < inlierThreshold) {
                    inliers.push(matches[i]);
                }
            }

            if (inliers.length > bestInlierCount) {
                bestInlierCount = inliers.length;
                bestInliers = inliers;
            }
        }

        if (bestInliers.length < 2) return null;

        // Refine with all inliers
        bestModel = estimateTransformFromPairs(bestInliers);
        if (bestModel) {
            bestModel.inlierCount = bestInliers.length;
            bestModel.totalMatches = matches.length;
        }

        return bestModel;
    }

    // ---- Main Comparison ----
    function compare(canvas1, canvas2, searchRadius) {
        searchRadius = searchRadius || 100;

        // Get image dimensions
        var w1 = canvas1.width, h1 = canvas1.height;

        // Work at reduced resolution for performance
        var scaleDown = Math.max(w1 / WORK_WIDTH, h1 / WORK_HEIGHT, 1);
        var workW = Math.round(w1 / scaleDown);
        var workH = Math.round(h1 / scaleDown);
        var scaledSearchRadius = Math.round(searchRadius / scaleDown);

        // Resize to working resolution
        var workCanvas1 = document.createElement('canvas');
        workCanvas1.width = workW;
        workCanvas1.height = workH;
        var wCtx1 = workCanvas1.getContext('2d');
        wCtx1.drawImage(canvas1, 0, 0, workW, workH);

        var workCanvas2 = document.createElement('canvas');
        workCanvas2.width = workW;
        workCanvas2.height = workH;
        var wCtx2 = workCanvas2.getContext('2d');
        wCtx2.drawImage(canvas2, 0, 0, workW, workH);

        var imgData1 = wCtx1.getImageData(0, 0, workW, workH);
        var imgData2 = wCtx2.getImageData(0, 0, workW, workH);

        // Convert to grayscale
        var gray1 = toGrayscale(imgData1, workW, workH);
        var gray2 = toGrayscale(imgData2, workW, workH);

        // Blur for noise reduction
        gray1 = gaussianBlur(gray1, workW, workH);
        gray2 = gaussianBlur(gray2, workW, workH);

        // Detect corners in both full images
        var corners1 = detectFAST(gray1, workW, workH, 25);
        var corners2 = detectFAST(gray2, workW, workH, 25);

        corners1 = nonMaxSuppression(corners1, workW, workH, 8);
        corners2 = nonMaxSuppression(corners2, workW, workH, 8);

        // Limit corners
        if (corners1.length > 500) corners1 = corners1.slice(0, 500);
        if (corners2.length > 500) corners2 = corners2.slice(0, 500);

        if (corners1.length < 5) {
            return { error: 'Not enough features in selected region (' + corners1.length + '). Try selecting an area with more detail.' };
        }
        if (corners2.length < 5) {
            return { error: 'Not enough features detected in frame 2.' };
        }

        // Match features
        var matches = matchFeatures(gray1, workW, workH, corners1, gray2, workW, workH, corners2, scaledSearchRadius);

        if (matches.length < 3) {
            return { error: 'Not enough feature matches found (' + matches.length + '). Try a larger selection or increase search radius.' };
        }

        // RANSAC to estimate transform
        var transform = ransacSimilarityTransform(matches, 1000, 3.0);

        if (!transform) {
            return { error: 'Could not estimate a stable transformation from the matches.' };
        }

        // Coarse result in original pixels
        var coarseTx = transform.tx * scaleDown;
        var coarseTy = transform.ty * scaleDown;

        // ---- Full-resolution refinement: translation + rotation + re-refinement ----
        // ROI is only used for feature matching above; refinement always uses full frame
        var refined = refineAtFullRes(canvas1, canvas2, w1, h1, coarseTx, coarseTy, transform.rotation);

        return {
            tx: refined.tx,
            ty: refined.ty,
            scale: transform.scale,
            rotation: refined.rotation,
            inlierCount: transform.inlierCount,
            totalMatches: transform.totalMatches,
            refinedConfidence: refined.confidence
        };
    }

    // ---- Full-resolution NCC refinement with sub-pixel interpolation ----

    function computeRegionNCC(gray1, gray2, w, h, rx, ry, rw, rh, offsetX, offsetY) {
        var n = 0, sum1 = 0, sum2 = 0, sum11 = 0, sum22 = 0, sum12 = 0;

        for (var y = 0; y < rh; y++) {
            var sy1 = ry + y;
            var sy2 = ry + y + offsetY;
            if (sy1 < 0 || sy1 >= h || sy2 < 0 || sy2 >= h) continue;

            var row1 = sy1 * w;
            var row2 = sy2 * w;

            for (var x = 0; x < rw; x++) {
                var sx1 = rx + x;
                var sx2 = rx + x + offsetX;
                if (sx1 < 0 || sx1 >= w || sx2 < 0 || sx2 >= w) continue;

                var v1 = gray1[row1 + sx1];
                var v2 = gray2[row2 + sx2];
                sum1 += v1;
                sum2 += v2;
                sum11 += v1 * v1;
                sum22 += v2 * v2;
                sum12 += v1 * v2;
                n++;
            }
        }

        if (n < 100) return -1;

        var mean1 = sum1 / n;
        var mean2 = sum2 / n;
        var var1 = sum11 / n - mean1 * mean1;
        var var2 = sum22 / n - mean2 * mean2;

        if (var1 < 1e-6 || var2 < 1e-6) return -1;

        return (sum12 / n - mean1 * mean2) / Math.sqrt(var1 * var2);
    }

    // ---- NCC with rotation (bilinear interpolation) ----
    // Forward model: sample image2 at R(angleDeg) * (p1 - center) + center + (offsetX, offsetY)
    // NCC peaks when angleDeg = true rotation angle (same convention as RANSAC)
    // edgeWeighted: if true, weight pixels by distance⁴ from center (for rotation sensitivity)
    // step: pixel step for sparse sampling (default 1 = every pixel)
    function computeRotatedNCC(gray1, gray2, w, h, rx, ry, rw, rh, offsetX, offsetY, angleDeg, edgeWeighted, step) {
        var angleRad = angleDeg * Math.PI / 180;
        var cosA = Math.cos(angleRad);
        var sinA = Math.sin(angleRad);
        var cx = w / 2;
        var cy = h / 2;
        step = step || 1;

        if (edgeWeighted) {
            var maxDist2 = cx * cx + cy * cy;
            var sumW = 0, sumWV1 = 0, sumWV2 = 0;
            var sumWV1V1 = 0, sumWV2V2 = 0, sumWV1V2 = 0;

            for (var y = 0; y < rh; y += step) {
                var sy1 = ry + y;
                if (sy1 < 0 || sy1 >= h) continue;

                for (var x = 0; x < rw; x += step) {
                    var sx1 = rx + x;
                    if (sx1 < 0 || sx1 >= w) continue;

                    // Forward rotation: R(angle) * (p1 - C) + C + offset
                    var dx = sx1 - cx;
                    var dy = sy1 - cy;
                    var p2x = cosA * dx - sinA * dy + cx + offsetX;
                    var p2y = sinA * dx + cosA * dy + cy + offsetY;

                    var ix = Math.floor(p2x);
                    var iy = Math.floor(p2y);
                    if (ix < 0 || ix >= w - 1 || iy < 0 || iy >= h - 1) continue;

                    var fx = p2x - ix;
                    var fy = p2y - iy;
                    var v2 = gray2[iy * w + ix] * (1 - fx) * (1 - fy)
                           + gray2[iy * w + ix + 1] * fx * (1 - fy)
                           + gray2[(iy + 1) * w + ix] * (1 - fx) * fy
                           + gray2[(iy + 1) * w + ix + 1] * fx * fy;

                    var v1 = gray1[sy1 * w + sx1];

                    // Weight = (distance / maxDistance)⁴ — very strong edge emphasis
                    var d2 = (dx * dx + dy * dy) / maxDist2;
                    var wt = d2 * d2; // distance⁴

                    sumW += wt;
                    sumWV1 += wt * v1;
                    sumWV2 += wt * v2;
                    sumWV1V1 += wt * v1 * v1;
                    sumWV2V2 += wt * v2 * v2;
                    sumWV1V2 += wt * v1 * v2;
                }
            }

            if (sumW < 1) return -1;

            var wMean1 = sumWV1 / sumW;
            var wMean2 = sumWV2 / sumW;
            var wVar1 = sumWV1V1 / sumW - wMean1 * wMean1;
            var wVar2 = sumWV2V2 / sumW - wMean2 * wMean2;

            if (wVar1 < 1e-6 || wVar2 < 1e-6) return -1;

            var wCov = sumWV1V2 / sumW - wMean1 * wMean2;
            return wCov / Math.sqrt(wVar1 * wVar2);
        }

        // Uniform NCC
        var n = 0, sum1 = 0, sum2 = 0, sum11 = 0, sum22 = 0, sum12 = 0;

        for (var y = 0; y < rh; y += step) {
            var sy1 = ry + y;
            if (sy1 < 0 || sy1 >= h) continue;

            for (var x = 0; x < rw; x += step) {
                var sx1 = rx + x;
                if (sx1 < 0 || sx1 >= w) continue;

                var dx = sx1 - cx;
                var dy = sy1 - cy;
                var p2x = cosA * dx - sinA * dy + cx + offsetX;
                var p2y = sinA * dx + cosA * dy + cy + offsetY;

                var ix = Math.floor(p2x);
                var iy = Math.floor(p2y);
                if (ix < 0 || ix >= w - 1 || iy < 0 || iy >= h - 1) continue;

                var fx = p2x - ix;
                var fy = p2y - iy;
                var v2 = gray2[iy * w + ix] * (1 - fx) * (1 - fy)
                       + gray2[iy * w + ix + 1] * fx * (1 - fy)
                       + gray2[(iy + 1) * w + ix] * (1 - fx) * fy
                       + gray2[(iy + 1) * w + ix + 1] * fx * fy;

                var v1 = gray1[sy1 * w + sx1];

                sum1 += v1;
                sum2 += v2;
                sum11 += v1 * v1;
                sum22 += v2 * v2;
                sum12 += v1 * v2;
                n++;
            }
        }

        if (n < 100) return -1;

        var mean1 = sum1 / n;
        var mean2 = sum2 / n;
        var var1 = sum11 / n - mean1 * mean1;
        var var2 = sum22 / n - mean2 * mean2;

        if (var1 < 1e-6 || var2 < 1e-6) return -1;

        return (sum12 / n - mean1 * mean2) / Math.sqrt(var1 * var2);
    }

    // ---- Downsample grayscale by 2x (box filter) ----
    function downsample2x(gray, w, h) {
        var hw = Math.floor(w / 2);
        var hh = Math.floor(h / 2);
        var out = new Float32Array(hw * hh);
        for (var y = 0; y < hh; y++) {
            for (var x = 0; x < hw; x++) {
                var sx = x * 2, sy = y * 2;
                out[y * hw + x] = (gray[sy * w + sx] + gray[sy * w + sx + 1]
                    + gray[(sy + 1) * w + sx] + gray[(sy + 1) * w + sx + 1]) * 0.25;
            }
        }
        return out;
    }

    // Convert RANSAC translation (rotation around origin) to NCC offset (rotation around frame center)
    // RANSAC: p2 = R(θ)*p1 + T  →  NCC: p2 = R(θ)*(p1-C)+C+off  →  off = T + (R(θ)-I)*C
    function ransacToNccOffset(ransacTx, ransacTy, angleDeg, imgW, imgH) {
        var rad = angleDeg * Math.PI / 180;
        var cosA = Math.cos(rad), sinA = Math.sin(rad);
        var cx = imgW / 2, cy = imgH / 2;
        return {
            x: ransacTx + (cosA - 1) * cx - sinA * cy,
            y: ransacTy + sinA * cx + (cosA - 1) * cy
        };
    }

    function refineAtFullRes(canvas1, canvas2, w, h, coarseTx, coarseTy, coarseRotation) {
        var ctx1 = canvas1.getContext('2d');
        var ctx2 = canvas2.getContext('2d');
        var fullGray1 = toGrayscale(ctx1.getImageData(0, 0, w, h), w, h);
        var fullGray2 = toGrayscale(ctx2.getImageData(0, 0, w, h), w, h);

        // Use 96% of frame (only 2% margin each side) — maximize edge signal
        var rx = Math.round(w * 0.02);
        var ry = Math.round(h * 0.02);
        var rw = Math.round(w * 0.96);
        var rh = Math.round(h * 0.96);

        // Half-resolution grayscale for coarse joint search
        var halfW = Math.floor(w / 2);
        var halfH = Math.floor(h / 2);
        var halfGray1 = downsample2x(fullGray1, w, h);
        var halfGray2 = downsample2x(fullGray2, w, h);
        var hrx = Math.round(halfW * 0.02);
        var hry = Math.round(halfH * 0.02);
        var hrw = Math.round(halfW * 0.96);
        var hrh = Math.round(halfH * 0.96);

        // Sub-pixel parabolic helper
        function parabolicPeak(scores, bestKey) {
            var rc = scores[bestKey], rm = scores[bestKey - 1], rp = scores[bestKey + 1];
            if (rm === undefined || rp === undefined || rc === undefined) return 0;
            var d = 2 * (rm + rp - 2 * rc);
            if (Math.abs(d) < 1e-10) return 0;
            return Math.max(-0.5, Math.min(0.5, (rm - rp) / d));
        }

        // ==== PHASE 0: Get reliable translation estimate at rotation=0 ====
        // Uses fast computeRegionNCC (no rotation, no bilinear) at full resolution.
        // This T estimate is used to compute expected NCC offsets for each rotation angle.
        var p0BaseTx = Math.round(coarseTx);
        var p0BaseTy = Math.round(coarseTy);
        var p0BestScore = -Infinity;
        var p0BestTx = p0BaseTx, p0BestTy = p0BaseTy;
        for (var dty = -10; dty <= 10; dty++) {
            for (var dtx = -10; dtx <= 10; dtx++) {
                var s = computeRegionNCC(fullGray1, fullGray2, w, h,
                    rx, ry, rw, rh, p0BaseTx + dtx, p0BaseTy + dty);
                if (s > p0BestScore) { p0BestScore = s; p0BestTx = p0BaseTx + dtx; p0BestTy = p0BaseTy + dty; }
            }
        }
        // At rotation=0, NCC offset = RANSAC T. So this is our refined T estimate.
        var estTx = p0BestTx;
        var estTy = p0BestTy;

        // ==== PHASE 1: Coarse joint rotation+translation at HALF resolution ====
        var bestJointScore = -Infinity;
        var bestJointRot = 0;
        var bestJointTx = 0;
        var bestJointTy = 0;

        for (var dr = -5.0; dr <= 5.0; dr += 0.5) {
            var expected = ransacToNccOffset(estTx, estTy, dr, w, h);
            var halfExpTx = expected.x / 2;
            var halfExpTy = expected.y / 2;

            for (var dty = -3; dty <= 3; dty++) {
                for (var dtx = -3; dtx <= 3; dtx++) {
                    var s = computeRotatedNCC(halfGray1, halfGray2, halfW, halfH,
                        hrx, hry, hrw, hrh,
                        halfExpTx + dtx, halfExpTy + dty, dr,
                        true, 3);
                    if (s > bestJointScore) {
                        bestJointScore = s;
                        bestJointRot = dr;
                        bestJointTx = halfExpTx + dtx;
                        bestJointTy = halfExpTy + dty;
                    }
                }
            }
        }

        // ==== PHASE 2: Fine rotation at FULL resolution (edge-weighted, step=2) ====
        // Use FLOAT expected offsets for each angle — no integer quantization
        var bestRotScore = -Infinity;
        var bestRot = bestJointRot;
        var rotScores = {};
        for (var dr = -0.5; dr <= 0.5; dr += 0.02) {
            var a = bestJointRot + dr;
            var key = Math.round(dr / 0.02);
            var expected = ransacToNccOffset(estTx, estTy, a, w, h);
            var s = computeRotatedNCC(fullGray1, fullGray2, w, h,
                rx, ry, rw, rh,
                expected.x, expected.y, a, true, 2);
            rotScores[key] = s;
            if (s > bestRotScore) { bestRotScore = s; bestRot = a; }
        }
        var bestRotKey = Math.round((bestRot - bestJointRot) / 0.02);
        bestRot += parabolicPeak(rotScores, bestRotKey) * 0.02;

        // ==== PHASE 3: Fine translation at FULL resolution (uniform NCC) ====
        // Derive center from Phase 1 joint result (more accurate than Phase 0's rotation=0 estimate).
        // Phase 1 gives NCC offset at bestJointRot; adjust for Phase 2's refined rotation.
        var p1FullTx = bestJointTx * 2;
        var p1FullTy = bestJointTy * 2;
        var r1Rad = bestJointRot * Math.PI / 180;
        var r2Rad = bestRot * Math.PI / 180;
        var dCos = Math.cos(r2Rad) - Math.cos(r1Rad);
        var dSin = Math.sin(r2Rad) - Math.sin(r1Rad);
        var cxF = w / 2, cyF = h / 2;
        var fullBaseTx = Math.round(p1FullTx + dCos * cxF - dSin * cyF);
        var fullBaseTy = Math.round(p1FullTy + dSin * cxF + dCos * cyF);

        var bestTxScore = -Infinity;
        var bestTx = fullBaseTx, bestTy = fullBaseTy;
        for (var dty = -10; dty <= 10; dty++) {
            for (var dtx = -10; dtx <= 10; dtx++) {
                var s = computeRotatedNCC(fullGray1, fullGray2, w, h,
                    rx, ry, rw, rh, fullBaseTx + dtx, fullBaseTy + dty, bestRot, false, 2);
                if (s > bestTxScore) { bestTxScore = s; bestTx = fullBaseTx + dtx; bestTy = fullBaseTy + dty; }
            }
        }

        // ==== PHASE 4: Final rotation polish at full res (±0.4°, step=2) ====
        var finalTx = bestTx;
        var finalTy = bestTy;
        var polishRotScores = {};
        var polishBestScore = -Infinity;
        var polishBestRot = bestRot;
        for (var dr = -0.4; dr <= 0.4; dr += 0.005) {
            var a = bestRot + dr;
            var key = Math.round(dr / 0.005);
            var s = computeRotatedNCC(fullGray1, fullGray2, w, h,
                rx, ry, rw, rh, Math.round(finalTx), Math.round(finalTy), a, true, 2);
            polishRotScores[key] = s;
            if (s > polishBestScore) { polishBestScore = s; polishBestRot = a; }
        }
        var polishRotKey = Math.round((polishBestRot - bestRot) / 0.005);
        polishBestRot += parabolicPeak(polishRotScores, polishRotKey) * 0.005;

        // ==== PHASE 5: Final translation — multi-scale sub-pixel search ====
        // Step 1: ±3px at 1px steps (coarse)
        var finalRot = polishBestRot;
        var p5BaseTx = Math.round(finalTx);
        var p5BaseTy = Math.round(finalTy);
        var p5BestScore = -Infinity;
        var p5BestTx = p5BaseTx, p5BestTy = p5BaseTy;
        for (var dty = -3; dty <= 3; dty++) {
            for (var dtx = -3; dtx <= 3; dtx++) {
                var s = computeRotatedNCC(fullGray1, fullGray2, w, h,
                    rx, ry, rw, rh, p5BaseTx + dtx, p5BaseTy + dty, finalRot, false);
                if (s > p5BestScore) { p5BestScore = s; p5BestTx = p5BaseTx + dtx; p5BestTy = p5BaseTy + dty; }
            }
        }

        // Step 2: ±1px at 0.25px steps around coarse winner (step=3 for speed)
        var p5MidScore = -Infinity;
        var p5MidTx = p5BestTx, p5MidTy = p5BestTy;
        for (var dty = -1.0; dty <= 1.0; dty += 0.25) {
            for (var dtx = -1.0; dtx <= 1.0; dtx += 0.25) {
                var s = computeRotatedNCC(fullGray1, fullGray2, w, h,
                    rx, ry, rw, rh, p5BestTx + dtx, p5BestTy + dty, finalRot, false, 3);
                if (s > p5MidScore) { p5MidScore = s; p5MidTx = p5BestTx + dtx; p5MidTy = p5BestTy + dty; }
            }
        }

        // Step 3: ±0.2px at 0.05px steps around mid winner (step=2 for precision)
        var p5FineScore = -Infinity;
        var p5FineTx = p5MidTx, p5FineTy = p5MidTy;
        for (var dty = -0.2; dty <= 0.2; dty += 0.05) {
            for (var dtx = -0.2; dtx <= 0.2; dtx += 0.05) {
                var s = computeRotatedNCC(fullGray1, fullGray2, w, h,
                    rx, ry, rw, rh, p5MidTx + dtx, p5MidTy + dty, finalRot, false, 2);
                if (s > p5FineScore) { p5FineScore = s; p5FineTx = p5MidTx + dtx; p5FineTy = p5MidTy + dty; }
            }
        }

        return {
            tx: p5FineTx,
            ty: p5FineTy,
            rotation: finalRot,
            confidence: p5FineScore
        };
    }

    return {
        compare: compare
    };
})();
