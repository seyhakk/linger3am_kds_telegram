const SUPABASE_URL = 'https://dcdqjbozueinbrmfumif.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjZHFqYm96dWVpbmJybWZ1bWlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzI3NDcsImV4cCI6MjA4OTgwODc0N30.VXxCEz1KIXxsh5_N-M1h7Fpa6OJ8oQCCSehWAzAiOoc';

async function sbFetch(path, options = {}) {
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
      method: options.method || "GET",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!res.ok) throw new Error("Supabase error " + res.status);
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  } catch (err) {
    console.warn('Fetch error:', err.message);
    throw err;
  }
}

let currentOrders = [];
let pollInterval;
let timerInterval;
let currentStatusFilter = 'new';

const state = {
  statusFilter: 'new'
};

async function init() {
  setupEventListeners();
  startPolling();
  startTimer();
  await fetchOrders();
}

function setupEventListeners() {
  document.querySelectorAll('.status-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentStatusFilter = tab.dataset.status;
      renderOrders();
    });
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    fetchOrders();
  });
}

function startPolling() {
  fetchOrders();
  pollInterval = setInterval(fetchOrders, 3000);
}

function startTimer() {
  timerInterval = setInterval(() => {
    updateDurations();
  }, 1000);
}

function updateDurations() {
  document.querySelectorAll('.order-card').forEach(card => {
    const created = card.dataset.created;
    if (created) {
      const duration = getDuration(new Date(created));
      const durationEl = card.querySelector('.order-duration');
      if (durationEl) {
        durationEl.textContent = duration;
        durationEl.className = 'order-duration ' + getDurationClass(created);
      }
      const cardEl = card;
      cardEl.classList.remove('age-warning', 'age-danger');
      const mins = getMinutesAgo(new Date(created));
      if (mins >= 10) cardEl.classList.add('age-danger');
      else if (mins >= 5) cardEl.classList.add('age-warning');
    }
  });
}

function getMinutesAgo(date) {
  return Math.floor((new Date() - date) / 60000);
}

function getDurationClass(created) {
  const mins = getMinutesAgo(new Date(created));
  if (mins >= 10) return 'danger';
  if (mins >= 5) return 'warning';
  return 'normal';
}

function getDuration(date) {
  const diff = new Date() - date;
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function fetchOrders() {
  try {
    const [ordersRes, itemsRes] = await Promise.all([
      sbFetch('orders?select=*&order=created_at.desc'),
      sbFetch('order_items?select=*')
    ]);
    
    const orders = ordersRes || [];
    const items = itemsRes || [];
    
    const orderItemsMap = {};
    items.forEach(item => {
      if (!orderItemsMap[item.order_id]) orderItemsMap[item.order_id] = [];
      orderItemsMap[item.order_id].push(item);
    });
    
    currentOrders = orders.map(order => ({
      ...order,
      items: orderItemsMap[order.id] || [],
      order_number: order.order_ref || order.id,
      customer_name: order.telegram_username || order.customer_name || 'Guest',
      status: order.status || 'new'
    }));

    updateCounts();
    renderOrders();
  } catch (err) {
    console.error('Failed to fetch orders:', err);
  }
}

function updateCounts() {
  const counts = { new: 0, preparing: 0, completed: 0 };
  currentOrders.forEach(order => {
    if (order.status === 'new' || order.status === 'pending') counts.new++;
    else if (order.status === 'preparing' || order.status === 'ready') counts.preparing++;
    else if (order.status === 'completed') counts.completed++;
  });
  
  document.getElementById('count-new').textContent = counts.new;
  document.getElementById('count-preparing').textContent = counts.preparing;
  document.getElementById('count-completed').textContent = counts.completed;
}

function renderOrders() {
  const container = document.getElementById('ordersContainer');
  
  const filtered = currentOrders.filter(order => {
    if (hiddenOrders.has(order.id)) return false;
    if (currentStatusFilter === 'new') {
      return order.status === 'new' || order.status === 'pending';
    } else if (currentStatusFilter === 'preparing') {
      return order.status === 'preparing' || order.status === 'ready';
    } else if (currentStatusFilter === 'completed') {
      return order.status === 'completed';
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No ${currentStatusFilter} orders</h3>
        <p>Orders will appear here automatically</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(order => createOrderCard(order)).join('');
}

function createOrderCard(order) {
  const duration = getDuration(new Date(order.created_at));
  const durationClass = getDurationClass(order.created_at);
  const ageClass = getMinutesAgo(new Date(order.created_at)) >= 10 ? 'age-danger' : (getMinutesAgo(new Date(order.created_at)) >= 5 ? 'age-warning' : '');

  const itemsHtml = order.items && order.items.length > 0
    ? order.items.map(item => `
        <div class="order-item">
          <span class="item-name">${item.item_name || ''}</span>
          <span class="item-quantity">x${item.qty || 1}</span>
        </div>
      `).join('')
    : '<div class="order-item"><span class="item-name">No items</span></div>';

  const isNew = order.status === 'new' || order.status === 'pending';
  const isPreparing = order.status === 'preparing' || order.status === 'ready';
  const isCompleted = order.status === 'completed';

  return `
    <div class="order-card ${ageClass}" data-order-id="${order.id}" data-created="${order.created_at}">
      <div class="order-header">
        <div class="order-info">
          <div class="order-number">#${order.order_number}</div>
          <div class="order-time">${new Date(order.created_at).toLocaleTimeString()}</div>
        </div>
        <div class="order-duration ${durationClass}">${duration}</div>
      </div>
      ${order.table_no ? `<div class="order-table">Table: ${order.table_no}</div>` : ''}
      <div class="order-items">
        ${itemsHtml}
      </div>
      <div class="order-customer">@${order.customer_name}</div>
      <div class="order-total">$${parseFloat(order.total_amount || 0).toFixed(2)}</div>
      <div class="order-actions">
        <button class="action-btn btn-preparing" 
          onclick="updateStatus('${order.id}', 'preparing')" 
          ${!isNew ? 'disabled' : ''}>PREPARE</button>
        <button class="action-btn btn-completed" 
          onclick="updateStatus('${order.id}', 'completed')" 
          ${!isNew && !isPreparing ? 'disabled' : ''}>DONE</button>
      </div>
    </div>
  `;
}

async function updateStatus(orderId, newStatus) {
  try {
    await sbFetch('orders?id=eq.' + orderId, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: { status: newStatus, updated_at: new Date().toISOString() }
    });
    await fetchOrders();
  } catch (err) {
    console.error('Failed to update status:', err);
  }
}

let hiddenOrders = new Set();

async function clearCompleted() {
  const completedOrders = currentOrders.filter(o => o.status === 'completed');
  completedOrders.forEach(o => hiddenOrders.add(o.id));
  renderOrders();
}

document.addEventListener('DOMContentLoaded', init);