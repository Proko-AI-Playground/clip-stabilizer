"""Generate Clip Stabilizer technical documentation as PDF."""

from fpdf import FPDF
import os
import re
import textwrap


# Map common Unicode chars to latin-1 safe equivalents
UNICODE_MAP = {
    '\u2713': 'v',      # checkmark
    '\u00B0': 'deg',    # degree
    '\u03b8': 'theta',  # theta
    '\u2248': '~=',     # approx
    '\u2260': '!=',     # not equal
    '\u2264': '<=',     # less or equal
    '\u2265': '>=',     # greater or equal
    '\u2192': '->',     # arrow
    '\u00D7': 'x',      # multiplication
    '\u2014': '--',     # em dash
    '\u2018': "'",      # left single quote
    '\u2019': "'",      # right single quote
    '\u201C': '"',      # left double quote
    '\u201D': '"',      # right double quote
}


def sanitize_text(text):
    """Replace non-latin-1 characters with safe equivalents."""
    for char, replacement in UNICODE_MAP.items():
        text = text.replace(char, replacement)
    # Remove any remaining non-latin-1 characters
    return text.encode('latin-1', errors='replace').decode('latin-1')

class DocPDF(FPDF):
    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(130, 130, 130)
            self.cell(0, 8, "Clip Stabilizer - Technical Documentation", align="R")
            self.ln(12)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(130, 130, 130)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def section_title(self, title, level=1):
        sizes = {1: 18, 2: 14, 3: 11}
        self.set_font("Helvetica", "B", sizes.get(level, 11))
        self.set_text_color(30, 30, 30)
        self.ln(4 if level > 1 else 6)
        self.cell(0, 8, sanitize_text(title))
        self.ln(6 if level == 1 else 4)
        if level == 1:
            self.set_draw_color(61, 154, 232)
            self.set_line_width(0.8)
            self.line(self.get_x(), self.get_y(), self.get_x() + 190, self.get_y())
            self.ln(4)

    def body_text(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(50, 50, 50)
        self.multi_cell(0, 5.5, sanitize_text(text))
        self.ln(2)

    def bullet(self, text, indent=10):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(50, 50, 50)
        x = self.get_x()
        self.cell(indent, 5.5, "")
        self.set_font("Helvetica", "B", 10)
        self.cell(4, 5.5, "-")
        self.set_font("Helvetica", "", 10)
        self.cell(2, 5.5, " ")
        self.multi_cell(0, 5.5, sanitize_text(text))
        self.ln(1)

    def code_block(self, code, max_lines=None):
        self.set_font("Courier", "", 7.5)
        self.set_fill_color(42, 42, 42)
        self.set_text_color(220, 220, 220)

        lines = code.split("\n")
        if max_lines and len(lines) > max_lines:
            lines = lines[:max_lines] + [f"  ... ({len(code.split(chr(10))) - max_lines} more lines)"]

        x_start = self.get_x()
        padding = 4
        line_h = 3.8

        # Calculate block height
        block_h = len(lines) * line_h + padding * 2

        # Check page break
        if self.get_y() + block_h > 270:
            self.add_page()

        y_start = self.get_y()
        self.set_xy(x_start, y_start)
        self.rect(x_start, y_start, 190, block_h, "F")
        self.set_xy(x_start + padding, y_start + padding)

        for line in lines:
            # Truncate long lines
            if len(line) > 115:
                line = line[:112] + "..."
            self.cell(0, line_h, sanitize_text(line))
            self.ln(line_h)

        self.set_xy(x_start, y_start + block_h + 3)
        self.set_text_color(50, 50, 50)

    def key_value(self, key, value):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(80, 80, 80)
        self.cell(45, 5.5, sanitize_text(key))
        self.set_font("Helvetica", "", 10)
        self.set_text_color(50, 50, 50)
        self.cell(0, 5.5, sanitize_text(value))
        self.ln(6)


def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    panel = os.path.join(base, "com.clipstabilizer.panel")

    pdf = DocPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)

    # ============================================================
    # COVER PAGE
    # ============================================================
    pdf.add_page()
    pdf.ln(50)
    pdf.set_font("Helvetica", "B", 32)
    pdf.set_text_color(255, 255, 255)
    # Blue banner
    pdf.set_fill_color(61, 154, 232)
    pdf.rect(0, 40, 210, 55, "F")
    pdf.set_xy(10, 50)
    pdf.cell(0, 15, "Clip Stabilizer", align="C")
    pdf.ln(14)
    pdf.set_font("Helvetica", "", 14)
    pdf.cell(0, 8, "Technical Documentation", align="C")

    pdf.set_text_color(80, 80, 80)
    pdf.set_xy(10, 110)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, "Adobe Premiere Pro CEP Extension", align="C")
    pdf.ln(7)
    pdf.cell(0, 7, "Automated edit-point stabilization via computer vision", align="C")

    pdf.set_xy(10, 145)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(130, 130, 130)
    pdf.cell(0, 6, "Version 1.0.0", align="C")
    pdf.ln(6)
    pdf.cell(0, 6, "2026-03-31", align="C")

    # ============================================================
    # TABLE OF CONTENTS
    # ============================================================
    pdf.add_page()
    pdf.section_title("Table of Contents")
    toc = [
        ("1. Overview", 3),
        ("2. Architecture", 3),
        ("3. Installation", 4),
        ("4. User Workflow", 4),
        ("5. Image Processing Pipeline", 5),
        ("    5.1 Feature Detection (FAST-9)", 5),
        ("    5.2 Feature Matching (NCC Patches)", 5),
        ("    5.3 RANSAC Transform Estimation", 6),
        ("    5.4 Full-Resolution Refinement", 6),
        ("6. Coordinate System & Correction", 7),
        ("7. File Reference", 8),
        ("8. Settings", 9),
        ("9. Source Code", 9),
    ]
    for item, page in toc:
        pdf.set_font("Helvetica", "", 11)
        pdf.set_text_color(50, 50, 50)
        indent = 10 if item.startswith("    ") else 0
        label = item.strip()
        pdf.cell(indent, 6, "")
        pdf.cell(150 - indent, 6, label)
        pdf.set_text_color(130, 130, 130)
        pdf.cell(0, 6, str(page), align="R")
        pdf.ln(7)

    # ============================================================
    # 1. OVERVIEW
    # ============================================================
    pdf.add_page()
    pdf.section_title("1. Overview")
    pdf.body_text(
        "Clip Stabilizer is an Adobe Premiere Pro CEP (Common Extensibility Platform) panel "
        "that automatically aligns two adjacent clips at an edit point. When a camera bumps or "
        "shifts between takes, the visual discontinuity at the cut is jarring. This tool detects "
        "the positional and rotational difference between the last frame of clip 1 and the first "
        "frame of clip 2, then applies a corrective Motion transform to clip 2."
    )

    pdf.section_title("Key Features", 2)
    pdf.bullet("One-click edit-point detection from playhead position")
    pdf.bullet("FFmpeg-based frame extraction from source media")
    pdf.bullet("Computer vision pipeline: FAST corners, NCC patch matching, RANSAC")
    pdf.bullet("Multi-phase full-resolution NCC refinement with sub-pixel accuracy")
    pdf.bullet("ROI selection for focused feature detection (e.g., exclude moving objects)")
    pdf.bullet("Automatic Premiere Pro Motion effect adjustment (Position, Rotation)")
    pdf.bullet("One-click undo to restore original clip properties")
    pdf.bullet("Persistent settings (Search Radius, FFmpeg path)")

    pdf.section_title("Requirements", 2)
    pdf.bullet("Adobe Premiere Pro 2022 (v22.0) or later")
    pdf.bullet("FFmpeg installed and accessible (PATH or custom path)")
    pdf.bullet("Windows OS (installer is .bat based)")

    # ============================================================
    # 2. ARCHITECTURE
    # ============================================================
    pdf.add_page()
    pdf.section_title("2. Architecture")
    pdf.body_text(
        "The extension follows the standard CEP architecture with three layers:"
    )

    pdf.section_title("Client (HTML/JS/CSS)", 2)
    pdf.body_text(
        "Runs in Chromium Embedded Framework (CEF) with Node.js enabled. Handles UI rendering, "
        "user interaction, FFmpeg process spawning, and the entire image processing pipeline. "
        "Uses Canvas API for frame manipulation and pixel-level operations."
    )

    pdf.section_title("Host (ExtendScript / JSX)", 2)
    pdf.body_text(
        "Runs in Premiere Pro's ExtendScript engine. Provides access to the timeline, clips, "
        "and Motion effect properties. Three main functions: getEditPointInfo() reads timeline "
        "state, applyCorrection() writes Motion values, undoCorrection() restores originals."
    )

    pdf.section_title("Communication", 2)
    pdf.body_text(
        "Client calls Host via csInterface.evalScript(). Host returns JSON-stringified results. "
        "A custom JSON polyfill is included for ExtendScript compatibility."
    )

    pdf.section_title("Data Flow Diagram", 2)
    pdf.code_block(
        "  User clicks [Load Edit]\n"
        "       |\n"
        "  Host: getEditPointInfo()  -->  clip paths + timestamps\n"
        "       |\n"
        "  Client: FFmpeg extracts frame1.jpg, frame2.jpg\n"
        "       |\n"
        "  Client: Load images into hidden canvases\n"
        "       |\n"
        "  User: (optional) Draw ROI on preview\n"
        "       |\n"
        "  User clicks [Stabilize]\n"
        "       |\n"
        "  Client: ImageProcessor.compare(canvas1, canvas2, radius, roi)\n"
        "       |   - Downscale to working resolution (1920x1080)\n"
        "       |   - FAST corner detection + NMS\n"
        "       |   - NCC patch matching with ratio test\n"
        "       |   - RANSAC similarity transform\n"
        "       |   - 5-phase full-resolution NCC refinement\n"
        "       |\n"
        "  Host: applyCorrection(tx, ty, rotation, sourceWidth)\n"
        "       |   - Read clip 1 Motion values\n"
        "       |   - Compute clip 2 correction with R(-theta) * scale * offset\n"
        "       |   - Write to clip 2 Motion properties\n"
        "       |\n"
        "  UI: Display results (Position X/Y, Rotation, Match count)"
    )

    # ============================================================
    # 3. INSTALLATION
    # ============================================================
    pdf.add_page()
    pdf.section_title("3. Installation")
    pdf.body_text("Run install.bat as Administrator. The script performs:")
    pdf.bullet("Enables unsigned CEP extensions (registry keys for CSXS.11 and CSXS.12)")
    pdf.bullet("Copies extension to %APPDATA%\\Adobe\\CEP\\extensions\\com.clipstabilizer.panel")
    pdf.bullet("Verifies FFmpeg availability in PATH")
    pdf.ln(2)
    pdf.body_text("After installation, restart Premiere Pro and open Window > Extensions > Clip Stabilizer.")

    # ============================================================
    # 4. USER WORKFLOW
    # ============================================================
    pdf.section_title("4. User Workflow")

    pdf.section_title("Step 1: Load Edit", 3)
    pdf.body_text(
        "Place the playhead on or near an edit point between two clips on a video track. "
        "Click 'Load Edit'. The extension finds the closest edit point, extracts the last "
        "frame of clip 1 and the first frame of clip 2 via FFmpeg, and displays a preview."
    )

    pdf.section_title("Step 2: ROI Selection (Optional)", 3)
    pdf.body_text(
        "Draw a rectangle on the preview to restrict feature detection to a specific region. "
        "This is useful when moving objects (people, cars) would confuse the matching. "
        "The ROI only affects which corners in frame 1 are used for matching; frame 2 corners "
        "are detected across the full frame. Full-resolution refinement always uses the entire frame."
    )

    pdf.section_title("Step 3: Stabilize", 3)
    pdf.body_text(
        "Click 'Stabilize'. The image processing pipeline runs and the result is applied to "
        "clip 2's Motion effect. The UI shows the applied Position X/Y, Rotation, and the "
        "number of inlier feature matches."
    )

    pdf.section_title("Step 4: Undo (if needed)", 3)
    pdf.body_text(
        "Click 'Undo' to restore clip 2's original Position and Rotation values."
    )

    # ============================================================
    # 5. IMAGE PROCESSING PIPELINE
    # ============================================================
    pdf.add_page()
    pdf.section_title("5. Image Processing Pipeline")
    pdf.body_text(
        "The core algorithm in imageProcessor.js detects the geometric transform between two "
        "frames using a feature-based approach, then refines with dense NCC at full resolution."
    )

    pdf.section_title("5.1 Preprocessing", 2)
    pdf.bullet("Downscale both frames to working resolution (max 1920x1080) for feature detection")
    pdf.bullet("Convert to grayscale using ITU-R BT.601 weights (0.299R + 0.587G + 0.114B)")
    pdf.bullet("Apply 5x5 Gaussian blur (sigma ~1.0) for noise reduction")

    pdf.section_title("5.2 Feature Detection: FAST-9", 2)
    pdf.body_text(
        "Uses the FAST-9 corner detector. For each pixel, examines 16 pixels on a Bresenham "
        "circle of radius 3. A corner is detected if 9 or more contiguous pixels are all "
        "brighter (or all darker) than the center pixel by a threshold (default: 25)."
    )
    pdf.bullet("Quick reject test: checks 4 cardinal points (0, 4, 8, 12) first")
    pdf.bullet("Corner score: sum of absolute differences of all 16 circle pixels")
    pdf.bullet("Non-Maximum Suppression (NMS) with radius 8px removes clusters")
    pdf.bullet("Top 500 corners retained per frame")

    pdf.section_title("5.3 Feature Matching: NCC Patches", 2)
    pdf.body_text(
        "Each corner gets a 31x31 patch descriptor, zero-mean unit-variance normalized. "
        "Matching uses Normalized Cross-Correlation (NCC) with constraints:"
    )
    pdf.bullet("Search radius constraint: only match corners within the configured pixel distance")
    pdf.bullet("NCC threshold: minimum score of 0.6 required")
    pdf.bullet("Ratio test: best match must be 1.3x better than second-best (Lowe's ratio)")
    pdf.bullet("ROI filter: only frame 1 corners inside ROI are used (frame 2 is full)")

    pdf.section_title("5.4 RANSAC Similarity Transform", 2)
    pdf.body_text(
        "Estimates a 4-parameter similarity transform (rotation, uniform scale, translation) "
        "from the feature matches using RANSAC:"
    )
    pdf.bullet("Model: x2 = a*x1 - b*y1 + tx,  y2 = b*x1 + a*y1 + ty")
    pdf.bullet("Minimum sample: 2 matches per iteration")
    pdf.bullet("1000 iterations, inlier threshold: 3.0 pixels")
    pdf.bullet("Final model refined with all inliers via least-squares (4x4 Gaussian elimination)")
    pdf.bullet("Returns: scale, rotation (degrees), translation (pixels), inlier count")

    pdf.add_page()
    pdf.section_title("5.5 Full-Resolution Refinement (5 Phases)", 2)
    pdf.body_text(
        "After RANSAC gives a coarse estimate, a multi-phase NCC refinement pipeline "
        "produces sub-pixel accurate results at full source resolution."
    )

    pdf.section_title("Phase 0: Translation at Rotation=0", 3)
    pdf.bullet("Full-resolution, fast integer-offset NCC (no rotation, no bilinear)")
    pdf.bullet("Search range: +/-10 pixels around RANSAC coarse estimate")
    pdf.bullet("Purpose: establish a reliable translation baseline (estTx, estTy)")

    pdf.section_title("Phase 1: Joint Rotation + Translation (Half-Res)", 3)
    pdf.bullet("Half-resolution with edge-weighted NCC (distance^4 weighting)")
    pdf.bullet("Rotation range: +/-5.0 degrees, step 0.25 degrees")
    pdf.bullet("Translation range: +/-4 half-res pixels around predicted NCC offset")
    pdf.bullet("NCC offset predicted via ransacToNccOffset(estTx, estTy, angle)")
    pdf.bullet("Step=2 sampling for performance")

    pdf.section_title("Phase 2: Fine Rotation (Full-Res, Edge-Weighted)", 3)
    pdf.bullet("Full-resolution, edge-weighted NCC (distance^4 from center)")
    pdf.bullet("Search range: +/-0.5 degrees around Phase 1 best, step 0.02 degrees")
    pdf.bullet("Sub-pixel parabolic interpolation on rotation scores")
    pdf.bullet("Uses float NCC offsets (no integer quantization)")

    pdf.section_title("Phase 3: Fine Translation (Full-Res)", 3)
    pdf.bullet("Uniform NCC (no edge weighting) at full resolution")
    pdf.bullet("Center derived from Phase 1 joint result (not Phase 0), adjusted for Phase 2 rotation change")
    pdf.bullet("Search range: +/-10 pixels")
    pdf.bullet("Sub-pixel parabolic interpolation on X and Y independently")

    pdf.section_title("Phase 4: Rotation Polish (Full-Res)", 3)
    pdf.bullet("Edge-weighted NCC at full resolution, step=1 (every pixel)")
    pdf.bullet("Search range: +/-0.15 degrees, step 0.005 degrees")
    pdf.bullet("Sub-pixel parabolic interpolation")

    pdf.section_title("Phase 5: Final Translation Touch-up", 3)
    pdf.bullet("Uniform NCC at full resolution after rotation polish")
    pdf.bullet("Search range: +/-3 pixels to correct rotation-induced translation shift")
    pdf.bullet("Sub-pixel parabolic interpolation")

    # ============================================================
    # 6. COORDINATE SYSTEM
    # ============================================================
    pdf.add_page()
    pdf.section_title("6. Coordinate System & Correction")

    pdf.section_title("NCC Offset Model", 2)
    pdf.body_text(
        "The refinement returns NCC offsets (tx, ty) in the rotation-around-frame-center model:"
    )
    pdf.code_block(
        "  frame2_pixel = R(theta) * (frame1_pixel - C) + C + (tx, ty)\n"
        "  where C = frame center"
    )

    pdf.section_title("Premiere Pro Motion Model", 2)
    pdf.body_text(
        "Premiere Pro positions clips using:"
    )
    pdf.code_block(
        "  screen = Position + R(Rotation) * (Scale/100) * (source_pixel - AnchorPoint)"
    )

    pdf.section_title("Correction Formula", 2)
    pdf.body_text(
        "To make clip 2 visually align with clip 1 at the edit point:"
    )
    pdf.code_block(
        "  clip2_rotation = clip1_rotation - theta\n"
        "  clip2_position = clip1_position - R(-theta) * (Scale1/100) * ncc_offset\n"
        "\n"
        "  Where:\n"
        "    R(-theta) = [[cos(t), sin(t)], [-sin(t), cos(t)]]\n"
        "    ncc_offset = (tx, ty) from refinement\n"
        "    Scale1 = clip 1's current scale percentage"
    )
    pdf.ln(2)
    pdf.body_text(
        "The R(-theta) rotation of the offset accounts for the fact that when we rotate clip 2, "
        "the effective position change direction also rotates. Position format is auto-detected "
        "(normalized 0-1 vs pixel values) and converted accordingly."
    )

    pdf.section_title("RANSAC-to-NCC Offset Conversion", 2)
    pdf.body_text("Used throughout the refinement pipeline:")
    pdf.code_block(
        "  ncc_offset = ransac_T + (R(theta) - I) * C\n"
        "\n"
        "  ncc_x = T_x + (cos(t)-1)*cx - sin(t)*cy\n"
        "  ncc_y = T_y + sin(t)*cx + (cos(t)-1)*cy"
    )

    # ============================================================
    # 7. FILE REFERENCE
    # ============================================================
    pdf.add_page()
    pdf.section_title("7. File Reference")

    files = [
        ("CSXS/manifest.xml",
         "CEP manifest. Declares extension ID (com.clipstabilizer.panel), host compatibility "
         "(Premiere Pro v22+), panel UI dimensions (320x500), and CEF flags (--enable-nodejs, --mixed-context)."),
        ("client/index.html",
         "Main panel HTML. Contains the UI structure: Load Edit button, preview canvas with ROI drawing, "
         "status/result/error display areas, and settings inputs."),
        ("client/style.css",
         "Panel styles. Dark theme (#232323 background) matching Premiere Pro's UI. "
         "Includes spinner animation, result grid, preview canvas crosshair cursor."),
        ("client/main.js",
         "Main controller. Orchestrates the workflow: Load Edit (FFmpeg extraction), "
         "preview rendering with ROI drawing, Stabilize (calls ImageProcessor + ExtendScript), Undo. "
         "Manages UI state transitions and persists settings to localStorage."),
        ("client/imageProcessor.js",
         "Core computer vision module. FAST-9 corner detection, NCC patch matching, RANSAC "
         "similarity estimation, and 5-phase full-resolution NCC refinement. ~890 lines. "
         "Returns sub-pixel accurate translation, rotation, and scale."),
        ("client/CSInterface.js",
         "Adobe CEP library. Provides csInterface.evalScript() for Client-Host communication."),
        ("host/index.jsx",
         "ExtendScript host. getEditPointInfo() finds adjacent clips near playhead, "
         "applyCorrection() computes and writes Motion values with R(-theta) correction, "
         "undoCorrection() restores saved originals. Includes JSON polyfill."),
        ("install.bat",
         "Installer. Enables unsigned CEP extensions via registry, copies files to "
         "%APPDATA%/Adobe/CEP/extensions/, checks FFmpeg availability."),
    ]

    for filename, desc in files:
        pdf.set_font("Courier", "B", 10)
        pdf.set_text_color(61, 154, 232)
        pdf.cell(0, 6, filename)
        pdf.ln(5)
        pdf.set_font("Helvetica", "", 9.5)
        pdf.set_text_color(70, 70, 70)
        pdf.multi_cell(0, 5, sanitize_text(desc))
        pdf.ln(3)

    # ============================================================
    # 8. SETTINGS
    # ============================================================
    pdf.section_title("8. Settings")

    pdf.section_title("Search Radius (px)", 3)
    pdf.body_text(
        "Maximum pixel distance for feature matching between frames. Default: 100. "
        "Increase for larger camera shifts (up to 300). Decrease for faster processing "
        "when shifts are small. Saved to localStorage."
    )

    pdf.section_title("FFmpeg Path", 3)
    pdf.body_text(
        "Path to FFmpeg executable. Default: 'ffmpeg' (uses PATH). Set to a full path "
        "if FFmpeg is not in PATH. Saved to localStorage."
    )

    # ============================================================
    # 9. SOURCE CODE
    # ============================================================
    pdf.add_page()
    pdf.section_title("9. Source Code")

    src_files = [
        ("host/index.jsx", os.path.join(panel, "host", "index.jsx")),
        ("client/main.js", os.path.join(panel, "client", "main.js")),
        ("client/imageProcessor.js", os.path.join(panel, "client", "imageProcessor.js")),
        ("client/index.html", os.path.join(panel, "client", "index.html")),
        ("client/style.css", os.path.join(panel, "client", "style.css")),
        ("CSXS/manifest.xml", os.path.join(panel, "CSXS", "manifest.xml")),
    ]

    for label, filepath in src_files:
        pdf.section_title(label, 2)
        try:
            code = read_file(filepath)
            pdf.code_block(code)
        except Exception as e:
            pdf.body_text(f"Error reading file: {e}")
        pdf.ln(4)

    # ============================================================
    # OUTPUT
    # ============================================================
    out_path = os.path.join(base, "Clip Stabilizer - Technical Documentation.pdf")
    pdf.output(out_path)
    print(f"PDF generated: {out_path}")


if __name__ == "__main__":
    main()
