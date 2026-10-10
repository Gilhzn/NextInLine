import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { ReceiptDto } from "@magiali/shared";
import { upload } from "../api/client";

export interface LocalFile {
  uri: string;
  mimeType: string;
  name: string;
}

const MAX_EDGE = 2000;

/** Downscales and re-encodes as JPEG: smaller uploads, and HEIC from iPhones becomes a format the server accepts. */
async function toUploadableJpeg(asset: ImagePicker.ImagePickerAsset, index: number): Promise<LocalFile> {
  const longest = Math.max(asset.width ?? 0, asset.height ?? 0);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (longest > MAX_EDGE) {
    if ((asset.width ?? 0) >= (asset.height ?? 0)) ctx.resize({ width: MAX_EDGE });
    else ctx.resize({ height: MAX_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return { uri: saved.uri, mimeType: "image/jpeg", name: `receipt-${Date.now()}-${index}.jpg` };
}

export type PickResult = { ok: true; files: LocalFile[] } | { ok: false; reason: "cancelled" | "permission" };

export async function captureWithCamera(): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: "permission" };
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
  if (result.canceled) return { ok: false, reason: "cancelled" };
  return { ok: true, files: await Promise.all(result.assets.map(toUploadableJpeg)) };
}

export async function pickFromLibrary(multiple: boolean): Promise<PickResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 30 : 1,
    quality: 1,
  });
  if (result.canceled) return { ok: false, reason: "cancelled" };
  return { ok: true, files: await Promise.all(result.assets.map(toUploadableJpeg)) };
}

export async function pickPdf(): Promise<PickResult> {
  const result = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], multiple: false });
  if (result.canceled) return { ok: false, reason: "cancelled" };
  return {
    ok: true,
    files: result.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType ?? "application/pdf", name: a.name })),
  };
}

/** The Har HaBituach report: Excel as downloaded, CSV, PDF, or a screenshot. */
export async function pickPolicyReport(): Promise<PickResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "text/comma-separated-values",
      "application/pdf",
      "image/*",
    ],
    multiple: false,
  });
  if (result.canceled) return { ok: false, reason: "cancelled" };
  return {
    ok: true,
    files: result.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType || "application/octet-stream", name: a.name })),
  };
}

export function uploadReceipt(file: LocalFile, memberId?: string): Promise<ReceiptDto> {
  return upload<ReceiptDto>("/v1/receipts", file, memberId ? { memberId } : {});
}

export function uploadDocument(file: LocalFile, kind: string): Promise<{ id: string; kind: string }> {
  return upload<{ id: string; kind: string }>("/v1/documents", file, { kind });
}
