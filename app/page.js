import DashboardClient from '@/components/DashboardClient';
import { AssetProvider } from '@/providers/AssetProvider';
import { Suspense } from 'react';

export default function Home() {
  return (
    <AssetProvider>
      <Suspense fallback={null}>
        <DashboardClient />
      </Suspense>
    </AssetProvider>
  );
}
