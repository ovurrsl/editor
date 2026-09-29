import { UsernameGate } from '@/features/community/components/username-gate'

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <UsernameGate>{children}</UsernameGate>
}
