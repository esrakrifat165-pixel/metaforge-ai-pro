// Shrinks an image in the browser before it is uploaded. This keeps each request small
// (hosting platforms limit request size) and lowers the cost of each AI call.
// Transparent areas become white, because JPEG has no transparency.

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export async function prepareImageForUpload(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser could not read the image.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("This browser could not prepare the image.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });

  if (!blob) {
    throw new Error("The image could not be converted for upload.");
  }
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new Error("The image is still too large after resizing.");
  }
  return blob;
}