/** The cart lives in the browser (localStorage); the server never sees it until checkout. */
export type CartItem = { gid: string; qty: number }
const KEY = "ab.cart"
const ORDERS = "ab.orders"
const listeners = new Set<() => void>()

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* private mode */
  }
  for (const l of listeners) l()
}
export const getCart = (): CartItem[] => read<CartItem[]>(KEY, [])
export const setCart = (items: CartItem[]) =>
  write(
    KEY,
    items.filter((i) => i.qty > 0),
  )
export const cartCount = () => getCart().reduce((a, i) => a + i.qty, 0)
export function addToCart(gid: string, qty = 1) {
  const items = getCart()
  const hit = items.find((i) => i.gid === gid)
  if (hit) hit.qty = Math.min(99, hit.qty + qty)
  else items.push({ gid, qty })
  setCart(items)
}
export function removeMerchant(merchantSlug: string) {
  setCart(getCart().filter((i) => !i.gid.startsWith(`dir:${merchantSlug}:`)))
}
export function onCartChange(l: () => void) {
  listeners.add(l)
  const storage = (e: StorageEvent) => {
    if (e.key === KEY) l()
  }
  window.addEventListener("storage", storage)
  return () => {
    listeners.delete(l)
    window.removeEventListener("storage", storage)
  }
}
export const myOrders = (): string[] => read<string[]>(ORDERS, [])
export const rememberOrder = (id: string) =>
  write(ORDERS, [id, ...myOrders().filter((x) => x !== id)].slice(0, 50))
