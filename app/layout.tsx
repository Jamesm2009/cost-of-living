export const metadata = {
  title: 'Cost Compare',
  description: 'Personalized cost-of-living comparison across US metros',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fafafa', color: '#111' }}>{children}</body>
    </html>
  );
}
