import { AuthGate } from "@/components/AuthGate";
import { DeveloperShell } from "@/components/developers/DeveloperShell";

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate requirePasskey={false} audience="developers">
      <DeveloperShell>{children}</DeveloperShell>
    </AuthGate>
  );
}
