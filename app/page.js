import DashboardClient from '@/components/DashboardClient';
import { AssetProvider } from '@/providers/AssetProvider';

export default function Home() {
  return (
    <AssetProvider>
      <DashboardClient />
    </AssetProvider>
  );
}
