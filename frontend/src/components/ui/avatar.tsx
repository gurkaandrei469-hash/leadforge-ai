// Initials avatar with a stable gradient derived from the name hash
const GRADIENTS = [
  'from-blue-500 to-violet-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-rose-500',
  'from-fuchsia-500 to-pink-500',
  'from-cyan-500 to-blue-500',
  'from-purple-500 to-indigo-500',
  'from-rose-500 to-orange-500',
  'from-lime-500 to-emerald-500',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

interface AvatarProps {
  name?: string | null;
  email?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

export function Avatar({ name, email, size = 'sm', className = '' }: AvatarProps) {
  const seed = name || email || 'anon';
  const grad = GRADIENTS[hash(seed) % GRADIENTS.length]!;
  const label = name ? initials(name) : email ? email[0]!.toUpperCase() : '?';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-sm ring-2 ring-background ${grad} ${SIZES[size]} ${className}`}
      aria-label={seed}
    >
      {label}
    </span>
  );
}
