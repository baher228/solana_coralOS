import {
  Bot,
  BriefcaseBusiness,
  LayoutDashboard,
  MessageCircle,
  Settings as SettingsIcon,
  Wallet as WalletIcon,
} from 'lucide-react'

export const SESSION_KEY = 'freelance-escrow-session'
export const ACCOUNTS_URL = './accounts.json'
export const terminal = new Set(['released', 'refunded', 'cancelled'])
export const DEFAULT_ACCOUNTS = [
  { id: 'northstar-employer', role: 'employer', name: 'Ava Hart', email: 'ava@northstar.test', organization: 'Northstar Studio' },
  { id: 'checkout-worker', role: 'worker', name: 'Leo Marin', email: 'leo@checkoutguild.test', organization: 'Checkout Guild' },
  { id: 'rivet-worker', role: 'worker', name: 'Mina Cole', email: 'mina@rivetworks.test', organization: 'Rivet Works' },
]
export const nav = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['jobs', 'Your Jobs', BriefcaseBusiness],
  ['chats', 'Chats', MessageCircle],
  ['agents', 'AI Agents', Bot],
  ['wallet', 'Wallet', WalletIcon],
  ['settings', 'Admin tools', SettingsIcon],
]
export const chatFilterLabels = {
  all: 'All',
  active: 'Active',
  needsReply: 'Needs reply',
  review: 'In review',
  completed: 'Completed',
}
