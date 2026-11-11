import AccountSignIn from "@/components/account-sign-in";

type Props = { searchParams: Promise<{ error?: string | string[] }> };

export default async function GuestLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const initialError = params.error === "social_auth"
    ? "Google sign-in did not finish. Please try again, or use email and password."
    : params.error === "wrong_account_type"
      ? "Sign in to open the guest workspace with this account."
      : "";
  return <AccountSignIn audience="guest" initialError={initialError} />;
}
