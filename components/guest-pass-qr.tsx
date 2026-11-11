"use client";

import { QRCodeSVG } from "qrcode.react";

export default function GuestPassQr({ token }: { token: string }) {
  return (
    <div className="flex justify-center rounded-2xl bg-white p-5">
      <QRCodeSVG value={token} size={240} level="M" includeMargin />
    </div>
  );
}
