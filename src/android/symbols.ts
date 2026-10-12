/* lucide icon → Material Symbols name, for the Android build (vite.config: lucide-react
   is aliased to src/android/lucide.tsx when VITE_NATIVE=1). Adding an icon on the web
   side means adding it here and re-running scripts/android-symbols.sh. */
export const SYMBOL: Record<string, string> = {
  AlertCircle: 'error', ArrowLeft: 'arrow_back', ArrowRight: 'arrow_forward', ArrowRightLeft: 'swap_horiz', ArrowUpDown: 'swap_vert',
  Baby: 'child_care', Beer: 'sports_bar', Bell: 'notifications', BellRing: 'notifications_active', BookOpen: 'menu_book',
  Calendar: 'calendar_today', CalendarDays: 'calendar_month', Check: 'check', CheckCircle2: 'check_circle', ChevronDown: 'expand_more',
  ChevronLeft: 'chevron_left', ChevronRight: 'chevron_right', Cigarette: 'smoking_rooms', Clock: 'schedule', Cloud: 'cloud',
  Coffee: 'coffee', Copy: 'content_copy', Download: 'download', Droplets: 'water_drop', Dumbbell: 'fitness_center',
  Eye: 'visibility', EyeOff: 'visibility_off', FileSpreadsheet: 'table_view', FileText: 'description', Film: 'movie',
  Fingerprint: 'fingerprint', Gift: 'redeem', Globe: 'language', Home: 'home', Info: 'info', KeyRound: 'key',
  Landmark: 'account_balance', LineChart: 'monitoring', Link2: 'link', Lock: 'lock', LockKeyhole: 'lock',
  LogIn: 'login', LogOut: 'logout', Mail: 'mail', MailCheck: 'mark_email_read', MapPin: 'location_on', Minus: 'remove',
  Moon: 'dark_mode', Package: 'package_2', Palette: 'palette', PawPrint: 'pets', Pencil: 'edit', Pill: 'medication',
  Plane: 'flight', Plus: 'add', PlusCircle: 'add_circle', Receipt: 'receipt_long', RefreshCw: 'refresh', RotateCcw: 'undo',
  Search: 'search', Settings: 'settings', Settings2: 'tune', Share: 'share', Share2: 'share', Shield: 'shield',
  ShieldAlert: 'gpp_maybe', ShieldCheck: 'verified_user', Shirt: 'checkroom', ShoppingBag: 'shopping_bag', ShoppingCart: 'shopping_cart',
  SlidersHorizontal: 'tune', Smartphone: 'smartphone', Sparkles: 'auto_awesome', Split: 'call_split', SprayCan: 'cleaning_services',
  Tag: 'sell', Timer: 'timer', TrainFront: 'train', Trash: 'delete', Trash2: 'delete', Trophy: 'trophy', Upload: 'upload',
  User: 'person', UserPlus: 'person_add', UserX: 'person_remove', Users: 'group', UtensilsCrossed: 'restaurant',
  Vibrate: 'vibration', Wallet: 'account_balance_wallet', Wifi: 'wifi', WifiOff: 'wifi_off', Wrench: 'build', X: 'close', Zap: 'bolt',
  // used by Android-only screens
  ExternalLink: 'open_in_new', Send: 'send', ScanLine: 'document_scanner', Image: 'photo_library', History: 'history', MoreVertical: 'more_vert', Camera: 'photo_camera',
}
