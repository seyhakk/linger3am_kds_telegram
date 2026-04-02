// Vercel API Route: /api/telegram-webhook
// Receives Telegram webhooks and forwards to Supabase with proper authentication
// This is publicly accessible and handles the JWT requirement

export default async function handler(req, res) {
  // Log incoming request
  console.log('========== WEBHOOK RECEIVED ==========')
  console.log('Method:', req.method)
  console.log('Headers:', JSON.stringify(req.headers, null, 2))
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    // Validate secret from header (sent by Telegram)
    const secretHeader = req.headers['x-telegram-bot-api-secret-token']
    const expectedSecret = process.env.WEBHOOK_SECRET
    
    console.log('Secret from header:', secretHeader ? 'PROVIDED' : 'NOT PROVIDED')
    console.log('Expected secret:', expectedSecret ? 'CONFIGURED' : 'NOT CONFIGURED')
    
    if (!expectedSecret) {
      console.error('WEBHOOK_SECRET not set in environment')
      return res.status(500).json({ ok: false, error: 'Server configuration error' })
    }
    
    if (secretHeader !== expectedSecret) {
      console.error('Invalid secret')
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }
    
    console.log('✅ Secret validated')
    
    // Get the update from Telegram
    const update = req.body
    console.log('Update:', JSON.stringify(update, null, 2))
    
    // Process the update directly (no need to forward to Edge Function)
    const result = await processUpdate(update)
    
    console.log('========== WEBHOOK COMPLETE ==========')
    return res.status(200).json(result)
    
  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
}

async function processUpdate(update) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!botToken || !supabaseUrl || !supabaseKey) {
    throw new Error('Missing environment variables')
  }
  
  // Handle callback query
  if (update.callback_query) {
    return await handleCallbackQuery(update.callback_query, botToken, supabaseUrl, supabaseKey)
  }
  
  // Handle message
  if (update.message) {
    return await handleMessage(update.message, botToken, supabaseUrl, supabaseKey)
  }
  
  return { ok: true, message: 'No action needed' }
}

async function handleCallbackQuery(callback, botToken, supabaseUrl, supabaseKey) {
  const chatId = callback.from.id
  const callbackData = callback.data
  const callbackId = callback.id
  const messageId = callback.message?.message_id
  
  console.log(`Callback from ${chatId}: ${callbackData}`)
  
  // Parse action and order ID
  const [action, orderId] = callbackData.split(':')
  
  // Validate order
  const order = await validateOrder(orderId, chatId, supabaseUrl, supabaseKey)
  if (!order) {
    await answerCallbackQuery(botToken, callbackId, '❌ Order not found', true)
    return { ok: false, error: 'Invalid order' }
  }
  
  // Check if already responded
  if (order.customer_response_type) {
    await answerCallbackQuery(botToken, callbackId, '✓ Already responded', false)
    return { ok: true, alreadyResponded: true }
  }
  
  // Process based on action
  if (action === 'coming_now') {
    await updateOrder(supabaseUrl, supabaseKey, orderId, { 
      customer_response_type: 'coming_now',
      customer_response_at: new Date().toISOString()
    })
    
    await editMessage(botToken, chatId, messageId,
      `✅ Response Recorded\n\n` +
      `Order: ${order.order_ref}\n` +
      `You selected: "I'm coming now"`
    )
    await answerCallbackQuery(botToken, callbackId, '✓ Recorded', false)
    return { ok: true, action: 'coming_now' }
    
  } else if (action === 'please_wait') {
    await updateOrder(supabaseUrl, supabaseKey, orderId, { 
      customer_response_type: 'please_wait',
      customer_response_at: new Date().toISOString()
    })
    
    await editMessage(botToken, chatId, messageId,
      `✅ Response Recorded\n\n` +
      `Order: ${order.order_ref}\n` +
      `You selected: "Please wait"`
    )
    await answerCallbackQuery(botToken, callbackId, '✓ Recorded', false)
    return { ok: true, action: 'please_wait' }
    
  } else if (action === 'custom_message') {
    await updateOrder(supabaseUrl, supabaseKey, orderId, { 
      awaiting_custom_message: true 
    })
    
    await editMessage(botToken, chatId, messageId,
      `✍️ Send Your Message\n\n` +
      `Order: ${order.order_ref}\n\n` +
      `Type your message to kitchen:`
    )
    await answerCallbackQuery(botToken, callbackId, '✍️ Type your message', false)
    return { ok: true, action: 'custom_message' }
  }
  
  return { ok: false, error: 'Unknown action' }
}

async function handleMessage(message, botToken, supabaseUrl, supabaseKey) {
  const chatId = message.from.id
  const text = message.text
  
  console.log(`Message from ${chatId}: ${text}`)
  
  // Find awaiting order
  const order = await getAwaitingOrder(supabaseUrl, supabaseKey, chatId)
  if (!order) {
    return { ok: true, message: 'No awaiting order' }
  }
  
  // Save custom message
  await updateOrder(supabaseUrl, supabaseKey, order.id, {
    customer_response_type: 'custom_message',
    customer_response_message: text,
    customer_response_at: new Date().toISOString(),
    awaiting_custom_message: false
  })
  
  // Confirm to customer
  await sendMessage(botToken, chatId,
    `✅ Message Sent!\n\n` +
    `Order: ${order.order_ref}\n` +
    `Your message: "${text}"`
  )
  
  return { ok: true, orderId: order.id }
}

// Database helpers
async function validateOrder(orderId, chatId, supabaseUrl, supabaseKey) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?id=eq.${orderId}&select=*&limit=1`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    }
  )
  
  if (!response.ok) return null
  const orders = await response.json()
  const order = orders[0]
  
  if (!order || order.telegram_chat_id !== chatId) return null
  return order
}

async function getAwaitingOrder(supabaseUrl, supabaseKey, chatId) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?telegram_chat_id=eq.${chatId}&awaiting_custom_message=eq.true&select=*&limit=1&order=created_at.desc`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    }
  )
  
  if (!response.ok) return null
  const orders = await response.json()
  return orders[0] || null
}

async function updateOrder(supabaseUrl, supabaseKey, orderId, data) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?id=eq.${orderId}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        ...data,
        updated_at: new Date().toISOString()
      })
    }
  )
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Update failed: ${error}`)
  }
  return true
}

// Telegram API helpers
async function answerCallbackQuery(botToken, callbackId, text, showAlert) {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text,
      show_alert: showAlert
    })
  })
}

async function editMessage(botToken, chatId, messageId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML'
    })
  })
}

async function sendMessage(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    })
  })
}