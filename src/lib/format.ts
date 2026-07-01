export const tod = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const money = (v: number, code: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(v || 0)
  } catch {
    return (v || 0).toFixed(2) + ' ' + code
  }
}
