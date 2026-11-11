"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { hasAccountRole } from "@/lib/account-roles";
import SiteHeader from "@/components/site-header";

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

async function makeMobileAvatar(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the photo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    return blob ? new File([blob], "guest-avatar.webp", { type: "image/webp" }) : file;
  } catch {
    return file;
  }
}

export default function GuestProfilePage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (avatarUrl.startsWith("blob:")) URL.revokeObjectURL(avatarUrl);
  }, [avatarUrl]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError || !data.user) {
        window.location.replace("/login?next=%2Fprofile");
        return;
      }
      if (!hasAccountRole(data.user.user_metadata, "guest")) {
        window.location.replace("/login?error=wrong_account_type");
        return;
      }
      const metadata = data.user.user_metadata ?? {};
      setUserId(data.user.id);
      setEmail(data.user.email ?? "");
      setName(String(metadata.full_name ?? metadata.name ?? ""));
      setInstagram(String(metadata.instagram_username ?? "").replace(/^@/, ""));
      setAvatarUrl(String(metadata.avatar_url ?? ""));
      setLoading(false);
    });
    return () => { active = false; };
  }, [supabase]);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError("");
    setMessage("");
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      setError("Choose an image file.");
      event.target.value = "";
      return;
    }
    if (selected.size > MAX_PHOTO_BYTES) {
      setError("Choose a photo smaller than 3 MB.");
      event.target.value = "";
      return;
    }
    const optimized = await makeMobileAvatar(selected);
    setPhoto(optimized);
    setAvatarUrl(URL.createObjectURL(optimized));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedInstagram = instagram.trim().replace(/^@/, "");
    if (name.trim().length < 2 || name.trim().length > 120) {
      setError("Enter a name between 2 and 120 characters.");
      return;
    }
    if (normalizedInstagram && !/^[A-Za-z0-9._]{1,30}$/.test(normalizedInstagram)) {
      setError("Instagram usernames can use letters, numbers, periods, and underscores (up to 30 characters).");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      let savedAvatarUrl = avatarUrl;
      if (photo) {
        const { error: uploadError } = await supabase.storage.from("guest-avatars").upload(`${userId}/avatar`, photo, {
          upsert: true,
          contentType: photo.type,
          cacheControl: "3600",
        });
        if (uploadError) throw new Error(uploadError.message.includes("Bucket not found")
          ? "Profile photo storage is not set up yet. Apply the latest Guestora database migration and try again."
          : `Could not upload your photo: ${uploadError.message}`);
        const { data } = supabase.storage.from("guest-avatars").getPublicUrl(`${userId}/avatar`);
        savedAvatarUrl = `${data.publicUrl}?v=${Date.now()}`;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          full_name: name.trim(),
          name: name.trim(),
          instagram_username: normalizedInstagram,
          avatar_url: savedAvatarUrl,
        },
      });
      if (updateError) throw updateError;
      setName(name.trim());
      setInstagram(normalizedInstagram);
      setAvatarUrl(savedAvatarUrl);
      setPhoto(null);
      setMessage("Your profile has been saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#080b12] text-slate-300">Loading your profile…</main>;

  return (
    <>
      <SiteHeader current="dashboard" />
      <main className="min-h-screen bg-[#080b12] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <Link href="/dashboard" className="text-sm font-semibold text-amber-300 hover:text-amber-200">← Guest dashboard</Link>
        <section className="mt-5 rounded-3xl border border-slate-800 bg-[#11151e] p-5 sm:p-8">
          <p className="text-xs font-extrabold tracking-[0.25em] text-amber-400">GUEST ACCOUNT</p>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Edit profile</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Keep your guest details ready for event applications.</p>

          <form onSubmit={saveProfile} className="mt-7 space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-[#080b12] text-2xl font-bold text-slate-300">
                {avatarUrl ? <img src={avatarUrl} alt="Your profile" className="h-full w-full object-cover" /> : name.trim().charAt(0).toUpperCase() || "G"}
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold hover:border-amber-400">
                Choose profile photo
                <input type="file" accept="image/*" onChange={choosePhoto} className="sr-only" />
              </label>
              <p className="text-xs text-slate-500">Image up to 3 MB</p>
            </div>

            <label className="block text-sm font-semibold">Full name
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={120} required className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-[#080b12] px-4 py-3 text-white outline-none focus:border-amber-400" />
            </label>
            <label className="block text-sm font-semibold">Email address
              <input value={email} readOnly className="mt-2 min-h-12 w-full rounded-xl border border-slate-800 bg-[#0b0e15] px-4 py-3 text-slate-400" />
              <span className="mt-1 block text-xs font-normal text-slate-500">Email is used to sign in and cannot be changed here.</span>
            </label>
            <label className="block text-sm font-semibold">Instagram username <span className="font-normal text-slate-500">(optional)</span>
              <div className="mt-2 flex min-h-12 items-center rounded-xl border border-slate-700 bg-[#080b12] px-4 focus-within:border-amber-400"><span className="text-slate-500">@</span><input value={instagram} onChange={(event) => setInstagram(event.target.value.replace(/^@/, ""))} autoComplete="off" maxLength={30} placeholder="yourusername" className="min-w-0 flex-1 bg-transparent px-2 py-3 text-white outline-none" /></div>
            </label>

            {error && <p role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
            {message && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-300">{message}</p>}
            <button disabled={saving} className="min-h-12 w-full rounded-xl bg-amber-400 px-5 py-3 font-bold text-black hover:bg-amber-300 disabled:opacity-50">{saving ? "Saving profile…" : "Save profile"}</button>
          </form>
        </section>
      </div>
      </main>
    </>
  );
}
