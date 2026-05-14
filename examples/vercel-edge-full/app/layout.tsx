export const metadata = {
  title: "Dualmark Vercel Edge Example",
  description: "Reference implementation of Dualmark on Vercel Edge middleware.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
