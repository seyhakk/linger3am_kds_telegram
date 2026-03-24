const SUPABASE_URL = 'https://dcdqjbozueinbrmfumif.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kHV_xJY_7zduu-ygvwn-8Q_Dnw4Fb8e';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentOrders = [];
let pollInterval;
let stations = [];
let config = { enableAlerts: true, alertSound: '/sounds/alert.mp3' };
let lastOrderCount = 0;

const state = {
  currentView: 'orders',
  stationFilter: '',
  statusFilter: '',
  sortBy: 'priority',
  selectedOrder: null
};

async function init() {
  await loadStations();
  await loadConfig();
  setupEventListeners();
  startPolling();
}

async function loadConfig() {
  config = { enableAlerts: true, alertSound: '/sounds/alert.mp3' };
}

async function loadStations() {
  try {
    // Try to fetch from stations table, or use default
    const { data, error } = await supabase.from('stations').select('*').order('sort_order');
    if (error || !data || data.length === 0) {
      stations = [
        { id: 1, name: 'Kitchen' },
        { id: 2, name: 'Bar' },
        { id: 3, name: 'Dessert' }
      ];
    } else {
      stations = data;
    }

    const select = document.getElementById('stationFilter');
    select.innerHTML = '<option value="">All Stations</option>';
    stations.forEach(s => {
      const option = document.createElement('option');
      option.value = s.id;
      option.textContent = s.name;
      select.appendChild(option);
    });
  } catch (err) {
    stations = [
      { id: 1, name: 'Kitchen' },
      { id: 2, name: 'Bar' },
      { id: 3, name: 'Dessert' }
    ];
  }
}

function startPolling() {
  fetchOrders();
  pollInterval = setInterval(fetchOrders, 3000); // Poll every 3 seconds
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
}

async function fetchOrders() {
  try {
    // Fetch from webhook_logs table (Telegram orders)
    let query = supabase.from('webhook_logs')
      .select('*')
      .order('created_at', { ascending: false });

    if (state.stationFilter) {
      query = query.eq('station_id', state.stationFilter);
    }

    const { data: orders, error } = await query;

    if (error) throw error;

    // Fetch order items for each order
    const ordersWithItems = await Promise.all((orders || []).map(async (order) => {
      const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id);
      return {
        ...order,
        items: items || [],
        order_number: order.id || order.order_id || 'ORD-' + order.id,
        customer_name: order.first_name || order.customer_name || 'Telegram User',
        status: order.status || 'pending',
        station_name: order.station_name || 'Kitchen'
      };
    }));

    const previousCount = currentOrders.length;
    currentOrders = ordersWithItems;

    if (ordersWithItems.length > previousCount) {
      if (config.enableAlerts) {
        playAlertSound();
      }
      console.log(`${ordersWithItems.length - previousCount} new order(s)!`);
    } else if (previousCount > 0 && ordersWithItems.length < previousCount) {
      console.log('Orders updated');
    }

    lastOrderCount = ordersWithItems.length;
    renderOrders();
  } catch (err) {
    console.error('Failed to fetch orders:', err);
  }
}

function renderOrders() {
  const container = document.getElementById('ordersContainer');

  if (currentOrders.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No orders found</h3><p>New orders will appear here automatically</p></div>';
    return;
  }

  const filtered = currentOrders
    .filter(o => !state.statusFilter || o.status === state.statusFilter)
    .sort((a, b) => {
      if (state.sortBy === 'priority') {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return new Date(b.created_at) - new Date(a.created_at);
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });

  container.innerHTML = filtered.map(order => createOrderCard(order)).join('');

  container.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', () => {
      const orderId = parseInt(card.dataset.orderId);
      const order = currentOrders.find(o => o.id === orderId);
      if (order) {
        openOrderModal(order);
      }
    });
  });
}

function createOrderCard(order) {
  const statusClass = `status-${order.status}`;
  const priorityClass = order.priority > 0 ? 'priority' : '';
  const timeAgo = getTimeAgo(new Date(order.created_at));

  const itemsHtml = order.items && order.items.length > 0
    ? order.items.map(item => `
        <div class="order-item">
          <span class="item-name">${item.item_name}</span>
          <span class="item-quantity">x${item.quantity}</span>
        </div>
      `).join('')
    : '<div class="order-item">No items</div>';

  return `
    <div class="order-card ${statusClass} ${priorityClass}" data-order-id="${order.id}">
      ${order.priority > 0 ? '<span class="priority-badge">PRIORITY</span>' : ''}
      <div class="order-header">
        <div>
          <div class="order-number">#${order.order_number}</div>
          <div class="order-time">${timeAgo}</div>
        </div>
      </div>
      <div class="order-station">📍 ${order.station_name || 'No station'}</div>
      <div class="order-items">
        ${itemsHtml}
      </div>
      <div class="order-footer">
        <div class="order-customer">👤 ${order.customer_name || 'Unknown'}</div>
        <div class="order-total">$${parseFloat(order.total_amount || 0).toFixed(2)}</div>
      </div>
    </div>
  `;
}

function openOrderModal(order) {
  state.selectedOrder = order;
  const modal = document.getElementById('orderModal');

  document.getElementById('modalOrderNumber').textContent = `Order #${order.order_number}`;
  document.getElementById('modalCustomer').textContent = order.customer_name || 'Unknown';
  document.getElementById('modalStation').textContent = order.station_name || 'Not assigned';
  document.getElementById('modalStatus').textContent = order.status;
  document.getElementById('modalTime').textContent = new Date(order.created_at).toLocaleString();

  const priorityRow = document.getElementById('priorityRow');
  priorityRow.style.display = order.priority > 0 ? 'flex' : 'none';
  document.getElementById('modalPriority').textContent = order.priority > 0 ? `Priority ${order.priority}` : 'None';

  const notesRow = document.getElementById('notesRow');
  notesRow.style.display = order.notes ? 'flex' : 'none';
  document.getElementById('modalNotes').textContent = order.notes || '';

  const itemsList = document.getElementById('modalItems');
  if (order.items && order.items.length > 0) {
    itemsList.innerHTML = order.items.map(item => `
      <li>
        <span>${item.item_name}</span>
        <span>x${item.quantity}</span>
      </li>
    `).join('');
  } else {
    itemsList.innerHTML = '<li>No items</li>';
  }

  document.getElementById('modalTotal').textContent = `$${parseFloat(order.total_amount || 0).toFixed(2)}`;

  modal.classList.add('active');
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    const { error } = await supabase
      .from('webhook_logs')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    if (error) throw error;

    await fetchOrders();
    if (state.selectedOrder && state.selectedOrder.id === orderId) {
      closeModals();
    }
  } catch (err) {
    console.error('Failed to update status:', err);
  }
}

async function togglePriority(orderId) {
  try {
    const order = currentOrders.find(o => o.id === orderId);
    const newPriority = order.priority > 0 ? 0 : 1;

    const { error } = await supabase
      .from('orders')
      .update({ priority: newPriority })
      .eq('id', orderId);

    if (error) throw error;

    await fetchOrders();
  } catch (err) {
    console.error('Failed to toggle priority:', err);
  }
}

async function fetchAnalytics() {
  try {
    const orders = currentOrders;

    const totalOrders = orders.length;
    const statusCounts = { pending: 0, preparing: 0, ready: 0, completed: 0, cancelled: 0 };
    const stationCounts = {};

    orders.forEach(order => {
      if (statusCounts.hasOwnProperty(order.status)) {
        statusCounts[order.status]++;
      }
      const stationName = order.station_name || 'Unknown';
      stationCounts[stationName] = (stationCounts[stationName] || 0) + 1;
    });

    const inProgress = statusCounts.pending + statusCounts.preparing + statusCounts.ready;
    const completedOrders = statusCounts.completed;

    // Calculate average prep time for completed orders
    const completedOrdersList = orders.filter(o => o.status === 'completed' && o.updated_at && o.created_at);
    let avgMins = 0;
    if (completedOrdersList.length > 0) {
      const totalMinutes = completedOrdersList.reduce((sum, order) => {
        const created = new Date(order.created_at);
        const updated = new Date(order.updated_at);
        return sum + (updated - created) / (1000 * 60);
      }, 0);
      avgMins = totalMinutes / completedOrdersList.length;
    }

    const data = {
      totalOrders: { count: totalOrders },
      ordersByStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
      ordersByStation: Object.entries(stationCounts).map(([name, count]) => ({ name, count })),
      avgPrepTime: { avg_minutes: avgMins },
      totalRevenue: { total: orders.filter(o => ['completed', 'ready'].includes(o.status)).reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0) }
    };

    renderAnalytics(data);
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}

function renderAnalytics(data) {
  document.getElementById('totalOrders').textContent = data.totalOrders?.count || 0;

  const statusCounts = {
    pending: 0,
    preparing: 0,
    ready: 0,
    completed: 0,
    cancelled: 0
  };

  data.ordersByStatus.forEach(item => {
    if (statusCounts.hasOwnProperty(item.status)) {
      statusCounts[item.status] = item.count;
    }
  });

  const inProgress = statusCounts.pending + statusCounts.preparing + statusCounts.ready;
  document.getElementById('inProgress').textContent = inProgress;
  document.getElementById('completedOrders').textContent = statusCounts.completed;

  const avgMins = data.avgPrepTime?.avg_minutes || 0;
  document.getElementById('avgPrepTime').textContent = avgMins ? `${avgMins.toFixed(1)} min` : '-';

  // Status chart
  const statusChart = document.getElementById('statusChart');
  const statusEntries = Object.entries(statusCounts).filter(([, count]) => count > 0);
  const maxStatus = Math.max(...statusEntries.map(([, count]) => count), 1);

  if (statusEntries.length > 0) {
    statusChart.innerHTML = statusEntries.map(([status, count]) => {
      const height = (count / maxStatus) * 150;
      const statusColors = {
        pending: '#fbbf24',
        preparing: '#3b82f6',
        ready: '#10b981',
        completed: '#6b7280',
        cancelled: '#ef4444'
      };
      return `
        <div class="chart-bar">
          <div class="bar" style="height: ${height}px; background: ${statusColors[status]};"></div>
          <div class="bar-label">${status}</div>
          <div class="bar-value">${count}</div>
        </div>
      `;
    }).join('');
  } else {
    statusChart.innerHTML = '<p style="color:#6b7280;grid-column:1/-1;">No data available</p>';
  }

  // Station chart
  const stationChart = document.getElementById('stationChart');
  if (data.ordersByStation && data.ordersByStation.length > 0) {
    const maxStation = Math.max(...data.ordersByStation.map(item => item.count), 1);
    stationChart.innerHTML = data.ordersByStation.map(item => {
      const height = (item.count / maxStation) * 150;
      return `
        <div class="chart-bar">
          <div class="bar" style="height: ${height}px;"></div>
          <div class="bar-label">${item.name || 'Unknown'}</div>
          <div class="bar-value">${item.count}</div>
        </div>
      `;
    }).join('');
  } else {
    stationChart.innerHTML = '<p style="color:#6b7280;grid-column:1/-1;">No data available</p>';
  }
}

function playAlertSound() {
  const audio = document.getElementById('alertSound');
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(err => {
      console.log('Alert sound failed to play (user interaction needed first)');
    });
  }
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function closeModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.remove('active');
  });
  state.selectedOrder = null;
}

function setupEventListeners() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  document.getElementById('stationFilter').addEventListener('change', (e) => {
    state.stationFilter = e.target.value;
    fetchOrders();
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.statusFilter = btn.dataset.status;
      fetchOrders();
    });
  });

  document.getElementById('sortBy').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderOrders();
  });

  document.getElementById('refreshBtn').addEventListener('click', fetchOrders);

  document.querySelectorAll('.close-btn, #closeModalBtn, #changeStatusBtn, #priorityBtn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.id === 'changeStatusBtn') {
        if (state.selectedOrder) {
          document.getElementById('statusModal').classList.add('active');
        }
      } else if (e.target.id === 'priorityBtn') {
        if (state.selectedOrder) {
          togglePriority(state.selectedOrder.id);
        }
      } else {
        closeModals();
      }
    });
  });

  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newStatus = btn.dataset.status;
      if (state.selectedOrder) {
        updateOrderStatus(state.selectedOrder.id, newStatus);
        closeModals();
      }
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModals();
      }
    });
  });
}

function switchView(view) {
  state.currentView = view;

  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `${view}View`);
  });

  if (view === 'analytics') {
    fetchAnalytics();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}