# KDS - Kitchen Display System (Supabase Version)

A real-time Kitchen Display System that fetches orders directly from Supabase. Perfect for restaurants where Telegram orders are already being saved to Supabase.

## Setup

### 1. Verify Supabase Tables

Your Supabase database should have these tables:

**stations**
- `id` (integer, primary key)
- `name` (text)
- `description` (text, optional)
- `sort_order` (integer, optional)
- `is_active` (boolean, optional)
- `created_at` (timestamp)

**orders**
- `id` (integer, primary key)
- `order_number` (text, unique)
- `customer_name` (text)
- `customer_phone` (text, optional)
- `station_id` (integer, foreign key to stations)
- `status` (text: 'pending', 'preparing', 'ready', 'completed', 'cancelled')
- `priority` (integer, default 0)
- `notes` (text, optional)
- `total_amount` (decimal, optional)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**order_items**
- `id` (integer, primary key)
- `order_id` (integer, foreign key to orders)
- `item_name` (text)
- `quantity` (integer, default 1)
- `unit_price` (decimal, optional)
- `notes` (text, optional)
- `created_at` (timestamp)

### 2. Enable Realtime

Go to your Supabase dashboard:
1. Navigate to **Database → Replication**
2. Enable **Realtime** for the `orders` table
3. This allows the KDS to update instantly when new orders arrive

### 3. Deploy Frontend

Simply host the `frontend/` folder on any static web host:

**Option A: Vercel (Recommended)**
```bash
cd frontend
vercel --prod
```

**Option B: Netlify**
```bash
cd frontend
netlify deploy --prod
```

**Option C: Any web server**
Copy `frontend/` contents to your web server's document root.

### 4. Access the KDS

Open your deployed URL in a browser. The system will:
- Load stations from Supabase
- Display orders in real-time
- Allow status updates (writes directly to Supabase)

## How It Works

1. **Real-time updates**: Uses Supabase Realtime to instantly show new orders
2. **Direct database access**: Frontend talks directly to Supabase (no backend needed)
3. **Status management**: Click any order to change status, toggle priority
4. **Analytics**: Built-in dashboard showing order statistics

## Customization

### Change Supabase Credentials

Edit `frontend/app.js` line 2-5:
```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'your-publishable-key';
```

### Table Name Mismatch?

If your tables have different names, update the queries in `app.js`:
- Line ~45: `.from('stations')` 
- Line ~73: `.from('orders')`
- Line ~82: `.from('order_items')`

## Security

- Uses Supabase `anon` (publishable) key for read/write access
- **Important**: Configure Row Level Security (RLS) policies in Supabase to control who can modify orders
- Without RLS, anyone with the URL can update order statuses

Recommended RLS policy:
```sql
-- Allow public read
CREATE POLICY "Allow public read" ON orders FOR SELECT USING (true);

-- Allow public updates (if you trust all users)
CREATE POLICY "Allow public update" ON orders FOR UPDATE USING (true);
```

For better security, use authentication (Supabase Auth) and scope policies to authenticated users only.

## Features

- Live order updates via Supabase Realtime
- Filter by station and status
- Priority flagging for urgent orders
- Time-ago display
- Analytics dashboard (orders by status/station, avg prep time)
- Audio alerts for new orders (browser requires user interaction first)
- Responsive design for tablets/monitors

## Troubleshooting

**No orders appearing?**
- Check browser console for Supabase errors
- Verify Supabase URL/key are correct
- Ensure `orders` table has data and `station_id` is valid
- Confirm Realtime is enabled

**Realtime not working?**
- Enable Realtime in Supabase dashboard for `orders` table
- Check Supabase logs for subscription errors

**Cannot update status?**
- Check RLS policies allow UPDATE operations
- Verify user has proper permissions
- Check browser console for error details

## Notes

- The backend folder is no longer needed (left for reference)
- All data flows directly between frontend and Supabase
- No server costs, just Supabase hosting
- Works offline if Supabase connection drops? (No, needs live connection)

Enjoy your KDS system!