const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

async function processImage(filePath) {
    try {
        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            throw new Error('File does not exist.');
        }

        const image = await Jimp.read(filePath);

        // Step 1: Crop out alpha channel areas and save the file
        const croppedImage = await cropAlpha(image);
        const alphaCroppedFilePath = path.join(path.dirname(filePath), 'alpha-cropped.png');
        await croppedImage.writeAsync(alphaCroppedFilePath);
        console.log('Alpha channel cropped image saved.');

        // Step 2: Identify two lines to divide the image into three sections with similar colors
        const maxLineThickness = 8; // Maximum thickness for the separating lines
        const lines = identifyDividingLines(croppedImage, maxLineThickness);

        if (lines.length !== 2) {
            throw new Error('Failed to identify two dividing lines in the image.');
        }

        // Step 3: Define the coordinates for the top, middle, and bottom areas based on identified lines
        const topBox = { x: 0, y: 0, w: croppedImage.bitmap.width, h: lines[0].start };
        const middleBox = { x: 0, y: lines[0].end, w: croppedImage.bitmap.width, h: lines[1].start - lines[0].end };
        const bottomBox = { x: 0, y: lines[1].end, w: croppedImage.bitmap.width, h: croppedImage.bitmap.height - lines[1].end };

        // Validate the dimensions and areas
        const validation = validateAreas(croppedImage, [topBox, middleBox, bottomBox]);
        if (validation.isValid) {
            // Step 4: Crop and resize the images, then save them separately
            const topImage = await cropImage(croppedImage, topBox);
            const middleImage = await cropImage(croppedImage, middleBox);
            const bottomImage = await cropImage(croppedImage, bottomBox);

            const outputDir = path.dirname(filePath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Resize images to the specified dimensions
            await topImage.resize(168, 40);
            await middleImage.resize(168, 100);
            await bottomImage.resize(168, 26);

            // Remove alpha channel and save the processed images
            await removeAlphaAndSave(topImage, path.join(outputDir, 'section-top.png'));
            await removeAlphaAndSave(middleImage, path.join(outputDir, 'section-middle.png'));
            await removeAlphaAndSave(bottomImage, path.join(outputDir, 'section-bottom.png'));

            console.log('Images cropped, resized, and saved locally.');
        } else {
            throw new Error(validation.message);
        }
    } catch (error) {
        console.error(`Error processing image: ${error.message}`);
    }
}

function validateAreas(image, areas) {
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    for (const area of areas) {
        if (area.x < 0 || area.y < 0 || area.x + area.w > width || area.y + area.h > height) {
            return { isValid: false, message: `Invalid area detected at x: ${area.x}, y: ${area.y}, width: ${area.w}, height: ${area.h}` };
        }
    }
    return { isValid: true, message: 'All areas are valid' };
}

async function cropImage(image, box) {
    return image.clone().crop(box.x, box.y, box.w, box.h);
}

async function cropAlpha(image) {
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    let left = width, right = 0, top = height, bottom = 0;

    // Loop through each pixel to find the bounds of the non-transparent area
    image.scan(0, 0, width, height, (x, y, idx) => {
        const alpha = image.bitmap.data[idx + 3]; // Alpha value
        if (alpha !== 0) {
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    });

    // Define the bounding box for the non-transparent area
    const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };

    // Crop the image to the bounding box
    const croppedImage = image.clone().crop(box.x, box.y, box.w, box.h);

    // Remove the alpha channel by setting all alpha values to fully opaque
    croppedImage.scan(0, 0, croppedImage.bitmap.width, croppedImage.bitmap.height, (x, y, idx) => {
        croppedImage.bitmap.data[idx + 3] = 255; // Set alpha to fully opaque
    });

    return croppedImage;
}

async function removeAlphaAndSave(image, outputPath) {
    // Set all alpha values to fully opaque
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
        image.bitmap.data[idx + 3] = 255; // Set alpha to fully opaque
    });

    await image.writeAsync(outputPath);
}

function identifyDividingLines(image, maxLineThickness) {
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const lines = [];

    // Calculate the average color for each row
    const rowAverages = [];
    for (let y = 0; y < height; y++) {
        let rSum = 0, gSum = 0, bSum = 0;
        for (let x = 0; x < width; x++) {
            const idx = image.getPixelIndex(x, y);
            rSum += image.bitmap.data[idx];
            gSum += image.bitmap.data[idx + 1];
            bSum += image.bitmap.data[idx + 2];
        }
        const avgR = rSum / width;
        const avgG = gSum / width;
        const avgB = bSum / width;
        rowAverages.push({ r: avgR, g: avgG, b: avgB });
    }

    // Find two lines with significant color changes
    for (let y = 1; y < height; y++) {
        const prev = rowAverages[y - 1];
        const current = rowAverages[y];
        const diff = Math.abs(prev.r - current.r) + Math.abs(prev.g - current.g) + Math.abs(prev.b - current.b);
        if (diff > 50) { // Adjust threshold as needed
            const end = y + maxLineThickness <= height ? y + maxLineThickness : height;
            lines.push({ start: y, end });
            y = end; // Skip the thickness range to avoid overlapping
            if (lines.length === 2) break;
        }
    }

    // Ensure exactly two lines are found, otherwise fallback to dividing equally
    if (lines.length !== 2) {
        lines[0] = { start: Math.floor(height / 3), end: Math.min(Math.floor(height / 3) + maxLineThickness, height - 1) };
        lines[1] = { start: Math.floor(2 * height / 3), end: Math.min(Math.floor(2 * height / 3) + maxLineThickness, height - 1) };
    }

    return lines;
}

// Test the function with a local image file
processImage('C:/Users/Admin/Desktop/crop/image-processing/image.png');
