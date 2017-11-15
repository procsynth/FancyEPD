$(document).ready(function(){

	// Relative luminance of each color channel (sRGB)
	const LUMA_R = 0.2126;
	const LUMA_G = 0.7152;
	const LUMA_B = 0.0722;

	var img = null;
	var file_name = null;

	const SCREENS = {
		"CFAP122250A00213": {dims: [122, 250]},
		"CFAP128296C00290": {dims: [128, 296]},
		"CFAP128296D00290": {dims: [128, 296], color: "black+red"},
		"E2215CS062": {dims: [112, 208]},
	};

	const PALETTES = {
		"1bpp_mono":      {name:"1bpp (black and white)"},
		"1bpc_2channels": {name:"1bpc (2 color channels)"},
		"2bpp_mono":      {name:"2bpp grayscale"},
		"2bpc_2channels": {name:"2bpc (2 color channels)"},
		"4bpp_mono":      {name:"4bpp grayscale"},
		"4bpc_2channels": {name:"4bpc (2 color channels)"},
	};

	_.each(Object.keys(SCREENS), function(key){
		var params = SCREENS[key];

		var label = key + " [" + params.dims.join(" × ") + "]";
		if (params.color) label += " " + params.color;

		// Add an <option> to the dropdown
		$('#screen').append($("<option></option>")
			.attr("value", key)
			.text(label));
	});

	_.each(Object.keys(PALETTES), function(key){
		$('#palette').append($("<option></option>")
			.attr("value", key)
			.text(PALETTES[key].name));
	});

	function dropzoneError(err, file) {
		alert("dropzoneError: " + err);
	}

	function onDropzoneData(file) {
		console.log("onDropzoneData:", file);

		// Sanitize image name: remove weird characters, etc
		file_name = file.name;
		file_name = file_name.replace(/\..*$/, "");	// remove extension
		file_name = file_name.replace(/\s/g, "_");	// spaces to underscores
		file_name = file_name.replace(/^([^A-Za-z_])/, "_$1");	// first char must be valid for C variable names

		img = new Image;
		img.onload = redrawImage;
		img.src = URL.createObjectURL(file);
	}

	function getOrientation() {
		return $("input[name=orientation]:checked").val();
	}

	function getWidth() {
		var screen = SCREENS[$('#screen').val()];
		var ori = getOrientation();
		return (ori === "portrait") ? screen.dims[0] : screen.dims[1];
	}

	function getHeight() {
		var screen = SCREENS[$('#screen').val()];
		var ori = getOrientation();
		return (ori === "portrait") ? screen.dims[1] : screen.dims[0];
	}

	function resizeDropzone() {
		var w = getWidth();
		var h = getHeight();
		$("#dropzone").css({"width": w+"px", "height": h+"px"});
		$("#drop_canvas").attr({"width": w, "height": h});

		redrawImage();
	}

	function redrawImage() {
		if (!img) return;

		$("#drop_help").remove();

		var w = getWidth();
		var h = getHeight();

		// Resize to cover the screen. Align centered.
		var scale = Math.max(w / img.width, h / img.height);
		var drawX = (w - (img.width * scale)) / 2;
		var drawY = (h - (img.height * scale)) / 2;

		// Draw to canvas
		var canvas = $('#drop_canvas').get(0);
		var ctx = canvas.getContext('2d');
		ctx.drawImage(img, drawX, drawY, img.width * scale, img.height * scale);

		// Convert to the desired palette
		var pal = $("#palette").val();

		// Brightness values will be rounded off to nearest
		// palette color (4 bits == 16 colors, etc.)
		var lum_steps = 255;
		switch (pal) {
			case "1bpp_mono":
			case "1bpc_2channels":
				lum_steps = 2; break;

			case "2bpp_mono":
			case "2bpc_2channels":
				lum_steps = 4; break;

			case "4bpp_mono":
			case "4bpc_2channels":
				lum_steps = 16; break;
		}

		// Color channel?
		var doColor = false;
		var hue = null;	// Range: 0 (red) .. 1 (red again)
		switch (pal) {
			case "1bpc_2channels":
			case "2bpc_2channels":
			case "4bpc_2channels":
				doColor = true;
				hue = 0.0;	// red
				break;
		}

		var hue_rgb = hsv2rgb((hue || 0), 1.0, 1.0);

		var imgData = ctx.getImageData(0, 0, w, h);
		var data = imgData.data;

		var channelData = [[]];
		if (doColor) channelData.push([]);

		// Each pixel has 4 bytes: RGBA.
		for (var i = 0; i < data.length; i += 4) {
			var r = data[i];
			var g = data[i + 1];
			var b = data[i + 2];

			var lum = 0.0;	// Will have range 0..255
			lum += r * LUMA_R;
			lum += g * LUMA_G;
			lum += b * LUMA_B;

			// Round off mono to the nearest palette color
			lum = Math.round(lum * ((lum_steps - 1) / 255.0));

			// Color channels (if any)
			var sat = 0.0;	// Will have range 0..255
			if (doColor) {
				var hsv = rgb2hsv(r / 255.0, g / 255.0, b / 255.0);

				// Pixel saturation amount.
				// Only activate the color channel if the pixel
				// is within 1/6 of color wheel.
				// FIXME: Need a shaping function here?
				//        Taper colors so orange -> 0 redness
				//        (does not appear pink).
				var delta = wrapCloseToTarget(hsv.h - hue, 1.0, 0.0);
				if (Math.abs(delta) < (1.0 / 12.0)) {
					sat = Math.round(hsv.s * (lum_steps - 1)) * 255.0;
				}

				// Black and red ink cannot be active simultaneously.
				sat = clamp(sat, 0, 0xff - lum);	// Total <= 0xff.
			}

			// lum and sat are ready
			channelData[0].push(lum);
			if (channelData[1]) channelData[1].push(sat);

			// Screen preview color
			lum *= (255.0 / (lum_steps - 1));
			data[i] = data[i + 1] = data[i + 2] = lum;
			data[i + 3] = 255;	// alpha

			if (sat) {
				var mult = sat * 0xff;
				data[i    ] += hue_rgb.r * mult;
				data[i + 1] += hue_rgb.g * mult;
				data[i + 2] += hue_rgb.b * mult;
			}
		}

		// Draw this to <canvas>
		ctx.putImageData(imgData, 0, 0);

		// Print the C code
		var format = pal;

		// Encode the image as uint8_t array
		var compression = $("#compression").is(":checked") ? 1 : 0;
		var encoder = new FancyEncoder(canvas, format, compression, channelData);

		var rawEncoder;
		if (compression) {
			rawEncoder = new FancyEncoder(canvas, format, false);

			var comprSize = encoder.byteCount;
			var rawSize = rawEncoder.byteCount;

			$("#rawBytes").text(rawSize);
			$("#compressedBytes").text(comprSize);
			$("#compressedPercent").text("(" + Math.round((comprSize / rawSize) * 100.0) + "% of original)");
		}

		// Share the code block
		var code = "static const uint8_t " + file_name + "[] = {\n";
		code += encoder.output;
		code += "};"
		$("#c_code").val(code);

		// Usage example
		var palette_enum = "k_image_none";
		if (pal === "1bpp_mono") palette_enum = "k_image_1bit";
		if (pal === "2bpp_mono") palette_enum = "k_image_2bit_monochrome";
		if (pal === "4bpp_mono") palette_enum = "k_image_4bit_monochrome";

		var usage = "";
		if (!compression) {
			usage = "epd.updateWithImage(" + file_name + ", " + palette_enum + ");"

		} else {
			usage = "epd.updateWithCompressedImage(" + file_name + ");"
		}

		$("#usage_example").text(usage);

		$("#codeSuccess").show();

		$("#copy_result").text("");

		// Show/hide #compressionInfo
		$("#stats").toggle(compression ? true : false);
	}

	function copyCodeToClipboard() {
		$("#c_code").select();

		try {
			var success = document.execCommand("copy");
			$("#copy_result").text("Copied!")

		} catch(err) {
			$("#copy_result").text("Oops, unable to copy.")
		}
	}

	$("#dropzone").filedrop({
		fallback_id: 'upload_button',
		fallback_dropzoneClick : true,
		error: dropzoneError,
		allowedfiletypes: ['image/jpeg','image/png','image/gif'],
		allowedfileextensions: ['.jpg','.jpeg','.png','.gif'],
		maxfiles: 1,
		maxfilesize: 20,	// max file size in MBs
		beforeEach: onDropzoneData
	});

	$("#screen").on("change", resizeDropzone);
	$("input[name=orientation]").on("change", resizeDropzone);
	$("#palette").on("change", redrawImage);
	$("#compression").on("change", redrawImage);
	$("#copy_to_clipboard").on("click", copyCodeToClipboard);

	// Init
	resizeDropzone();

});
