const SUPABASE_URL = window.ENV?.SUPABASE_URL || 'https://dcdqjbozueinbrmfumif.supabase.co';
const SUPABASE_KEY = window.ENV?.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjZHFqYm96dWVpbmJybWZ1bWlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzI3NDcsImV4cCI6MjA4OTgwODc0N30.VXxCEz1KIXxsh5_N-M1h7Fpa6OJ8oQCCSehWAzAiOoc';

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

const SUPABASE_PROJECT_REF = 'dcdqjbozueinbrmfumif';

async function callEdgeFunction(functionName, data) {
  try {
    const url = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/${functionName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    const result = await res.json();
    
    if (!res.ok) {
      throw new Error(result.error || `Edge function error: ${res.status}`);
    }
    
    return result;
  } catch (err) {
    console.error('Edge function error:', err);
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
    // Select all fields - let Supabase return whatever exists
    const [ordersRes, itemsRes] = await Promise.all([
      sbFetch('orders?select=*&order=created_at.desc'),
      sbFetch('order_items?select=*')
    ]);
    
    const orders = ordersRes || [];
    const items = itemsRes || [];
    
    console.log('Fetched orders:', orders.length);
    console.log('Sample order:', orders[0]);
    
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
      status: order.status || 'new',
      // Ensure new fields exist with defaults
      telegram_chat_id: order.telegram_chat_id || order.telegram_user_id || null,
      customer_notified_at: order.customer_notified_at || null,
      notification_status: order.notification_status || 'pending',
      notification_error: order.notification_error || null,
      // Customer response fields
      customer_response_type: order.customer_response_type || null,
      customer_response_message: order.customer_response_message || null,
      customer_response_at: order.customer_response_at || null,
      awaiting_custom_message: order.awaiting_custom_message || false
    }));

    console.log('Processed orders:', currentOrders.length);
    console.log('Sample processed order:', currentOrders[0]);

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

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[m]));
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
  const isPreparing = order.status === 'preparing';
  const isReady = order.status === 'ready';
  const isCompleted = order.status === 'completed';
  
  const hasChatId = order.telegram_chat_id != null;
  const notificationStatus = order.notification_status || 'pending';
  const alreadyNotified = order.customer_notified_at != null;
  
  // Customer response display
  const responseType = order.customer_response_type;
  const responseMessage = order.customer_response_message;
  const responseAt = order.customer_response_at;
  
  let notificationBadge = '';
  if (alreadyNotified) {
    notificationBadge = '<div class="notification-badge success">✓ Notified</div>';
  } else if (notificationStatus === 'failed') {
    notificationBadge = `<div class="notification-badge error">⚠️ Failed</div>`;
  } else if (!hasChatId) {
    notificationBadge = '<div class="notification-badge warning">⚠️ No Chat ID</div>';
  }
  
  // Customer response badge
  let responseBadge = '';
  if (responseType === 'coming_now') {
    responseBadge = '<div class="response-badge coming">✅ Coming Now</div>';
  } else if (responseType === 'please_wait') {
    responseBadge = '<div class="response-badge wait">⏳ Customer Waiting</div>';
  } else if (responseType === 'custom_message' && responseMessage) {
    const displayMessage = responseMessage.length > 50 ? responseMessage.substring(0, 50) + '...' : responseMessage;
    responseBadge = `<div class="response-badge custom">💬 "${escHtml(displayMessage)}"</div>`;
  }
  
  const canNotify = hasChatId && !alreadyNotified && (isNew || isPreparing);

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
      ${notificationBadge}
      ${responseBadge}
      <div class="order-items">
        ${itemsHtml}
      </div>
      <div class="order-customer">@${order.customer_name}</div>
      <div class="order-total">$${parseFloat(order.total_amount || 0).toFixed(2)}</div>
      <div class="order-actions">
        <button class="action-btn btn-preparing" 
          onclick="updateStatus('${order.id}', 'preparing')" 
          ${!isNew ? 'disabled' : ''}>PREPARE</button>
        ${canNotify ? `
          <button class="action-btn btn-notify" 
            onclick="markReadyAndNotify('${order.id}')" 
            title="Mark as ready and notify customer">
            🔔 READY
          </button>
        ` : ''}
        <button class="action-btn btn-completed" 
          onclick="updateStatus('${order.id}', 'completed')" 
          ${!isReady ? 'disabled' : ''}>✓ DONE</button>
        ${notificationStatus === 'failed' ? `
          <button class="action-btn btn-retry" 
            onclick="retryNotification('${order.id}')" 
            title="Retry sending notification">
            🔁 Retry
          </button>
        ` : ''}
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

async function markReadyAndNotify(orderId) {
  console.log('markReadyAndNotify called with orderId:', orderId);
  console.log('currentOrders:', currentOrders);
  console.log('Number of orders:', currentOrders.length);
  
  // Try to find order with both string and comparison
  const order = currentOrders.find(o => {
    const match = o.id === orderId || o.id === String(orderId) || String(o.id) === orderId;
    console.log(`Checking order ${o.id} === ${orderId}:`, match);
    return match;
  });
  
  console.log('Found order:', order);
  
  if (!order) {
    console.error('Order not found in currentOrders array');
    alert('Order not found. Please refresh the page and try again.');
    await fetchOrders();
    return;
  }

  const hasChatId = order.telegram_chat_id != null;
  
  if (!hasChatId) {
    const confirmComplete = confirm(
      '⚠️ No Telegram chat ID available for this order.\n\n' +
      'The customer will NOT receive a notification.\n\n' +
      'Mark as completed anyway?'
    );
    
    if (confirmComplete) {
      await updateStatus(orderId, 'completed');
    }
    return;
  }

  const alreadyNotified = order.customer_notified_at != null;
  
  if (alreadyNotified) {
    alert('✓ Customer already notified at: ' + new Date(order.customer_notified_at).toLocaleString());
    return;
  }

  try {
    const btn = document.querySelector(`[onclick*="markReadyAndNotify('${orderId}')"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '🔄 Sending...';
    }

    await sbFetch('orders?id=eq.' + orderId, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: { 
        status: 'ready',
        ready_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });

    const result = await callEdgeFunction('notify-customer', {
      order_id: orderId,
      order_ref: order.order_ref || order.order_number || orderId,
      telegram_chat_id: order.telegram_chat_id,
      telegram_username: order.telegram_username,
      table_no: order.table_no,
      total_amount: order.total_amount || order.total,
      item_count: order.item_count
    });

    if (result.success) {
      if (btn) {
        btn.textContent = '✓ Notified';
        btn.className = 'action-btn btn-success';
      }
      await fetchOrders();
    } else {
      throw new Error(result.error || 'Notification failed');
    }
  } catch (err) {
    console.error('Failed to notify customer:', err);
    
    const btn = document.querySelector(`[onclick*="markReadyAndNotify('${orderId}')"]`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔔 READY';
      btn.className = 'action-btn btn-notify';
    }
    
    alert(
      '❌ Failed to send notification!\n\n' +
      'Error: ' + err.message + '\n\n' +
      'The order status has been updated but the customer was not notified.\n' +
      'You can retry using the "Retry" button.'
    );
    
    await fetchOrders();
  }
}

async function retryNotification(orderId) {
  const order = currentOrders.find(o => o.id === orderId);
  if (!order) {
    alert('Order not found');
    return;
  }

  if (!order.telegram_chat_id) {
    alert('⚠️ Cannot retry: No Telegram chat ID available');
    return;
  }

  try {
    const btn = document.querySelector(`[onclick*="retryNotification('${orderId}')"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '🔄 Retrying...';
    }

    const result = await callEdgeFunction('notify-customer', {
      order_id: orderId,
      order_ref: order.order_ref || order.order_number || orderId,
      telegram_chat_id: order.telegram_chat_id,
      telegram_username: order.telegram_username,
      table_no: order.table_no,
      total_amount: order.total_amount || order.total,
      item_count: order.item_count
    });

    if (result.success) {
      if (btn) {
        btn.textContent = '✓ Sent';
        btn.className = 'action-btn btn-success';
      }
      await fetchOrders();
    } else {
      throw new Error(result.error || 'Retry failed');
    }
  } catch (err) {
    console.error('Failed to retry notification:', err);
    
    const btn = document.querySelector(`[onclick*="retryNotification('${orderId}')"]`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔁 Retry';
    }
    
    alert('❌ Retry failed!\n\nError: ' + err.message);
  }
}

let hiddenOrders = new Set();

async function clearCompleted() {
  const completedOrders = currentOrders.filter(o => o.status === 'completed');
  
  if (completedOrders.length === 0) {
    return;
  }

  const confirmClear = confirm(
    `Archive ${completedOrders.length} completed order(s)?\n\nThis will move them to the archive.`
  );
  
  if (!confirmClear) {
    return;
  }

  try {
    for (const order of completedOrders) {
      await sbFetch('orders?id=eq.' + order.id, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: { 
          status: 'archived',
          updated_at: new Date().toISOString()
        }
      });
    }
    await fetchOrders();
  } catch (err) {
    console.error('Failed to archive orders:', err);
    alert('Failed to archive orders. Please try again.');
  }
}

document.addEventListener('DOMContentLoaded', init);