import { PageHeader } from '../../../components/ui';
import StudentRecordsPanel from '../../../components/students/StudentRecordsPanel';

export default function StudentRecordsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader />
      <StudentRecordsPanel />
    </div>
  );
}
