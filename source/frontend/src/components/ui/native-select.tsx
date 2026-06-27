export function NativeSelect({
  id,
  value,
  onChange,
  disabled,
  children,
}: {
  id: string
  value: string
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30"
    >
      {children}
    </select>
  )
}
