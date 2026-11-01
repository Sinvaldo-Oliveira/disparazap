import type { NavigationItem } from '../app/navigation';
import { PageHeader } from '../components/PageHeader';
import { InDevelopmentBadge } from '../components/StatusBadge';
import { UnderConstruction } from '../components/UnderConstruction';

export function ModulePage({ item }: { item: NavigationItem }) {
  return (
    <>
      <PageHeader title={item.label} icon={item.icon} badge={<InDevelopmentBadge />} />
      <UnderConstruction summary={item.summary} plannedFor={item.plannedFor} />
    </>
  );
}
