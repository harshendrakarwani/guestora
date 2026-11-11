# Guestora

Guestora is an event discovery and guest-list platform for event organizers and guests. Guests can find events, apply to join guest lists, and use digital passes at check-in. Organizers can review applications and manage their event workflows.

## Highlights

- Event discovery and event detail pages
- Organizer review and approval workflows for guest-list applications
- Digital guest passes with QR codes for check-in
- Payment and refund workflows
- Email and WhatsApp notifications and guest access links
- Organizer dashboards and support tools

## Technology

- Next.js App Router, React, TypeScript, and Tailwind CSS
- Supabase for application data and authentication
- Razorpay payment integration
- Resend and WhatsApp messaging integrations

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the required values in your local environment. Never commit `.env.local` or production credentials.
3. Start the development server with `npm run dev`.
4. Open `http://localhost:3000`.

Apply database migrations in `supabase/migrations` to the intended Supabase environment before deploying code that depends on them. Keep credentials in environment variables and use test credentials for development.

## Useful scripts

- `npm run dev` — start the local development server
- `npm run build` — create a production build
- `npm run start` — serve a production build
- `npm run lint` — run ESLint
- `npm run test:safety` — run payment safety tests
