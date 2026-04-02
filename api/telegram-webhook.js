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
  
  console.log(`\n========== CALLBACK QUERY ==========`)
  console.log(`Chat ID: ${chatId}`)
  console.log(`Callback Data: ${callbackData}`)
  console.log(`Callback ID: ${callbackId}`)
  console.log(`Message ID: ${messageId}`)
  
  // Parse action and order ID
  const parts = callbackData.split(':')
  if (parts.length !== 2) {
    console.error('Invalid callback data format')
    await answerCallbackQuery(botToken, callbackId, '❌ Invalid request format', true)
    return { ok: false, error: 'Invalid format' }
  }
  
  const [action, orderId] = parts
  console.log(`Action: ${action}, Order ID: ${orderId}`)
  
  // Validate order
  console.log('Validating order...')
  const order = await validateOrder(orderId, chatId, supabaseUrl, supabaseKey)
  if (!order) {
    console.error('Order validation failed')
    await answerCallbackQuery(botToken, callbackId, '❌ Order not found or not yours', true)
    return { ok: false, error: 'Invalid order' }
  }
  
  console.log(`✓ Order found: ${order.order_ref}`)
  console.log(`Order status: ${order.status}`)
  console.log(`Existing response: ${order.customer_response_type || 'none'}`)
  
  // Check if order is closed
  if (order.status === 'completed' || order.status === 'cancelled') {
    console.log('Order is already closed')
    await answerCallbackQuery(botToken, callbackId, '❌ This order is already closed', true)
    return { ok: false, error: 'Order closed' }
  }
  
  // Check if already responded
  if (order.customer_response_type) {
    console.log('Duplicate response detected')
    await answerCallbackQuery(botToken, callbackId, '✓ You already responded to this order', false)
    return { ok: true, alreadyResponded: true }
  }
  
  // Process based on action
  if (action === 'coming_now') {
    console.log('Processing: coming_now')
    
    try {
      await updateOrder(supabaseUrl, supabaseKey, orderId, { 
        customer_response_type: 'coming_now',
        customer_response_at: new Date().toISOString()
      })
      console.log('✓ Database updated')
      
      // Edit the message to show response
      const newText = `✅ <b>Response Recorded</b>\n\n` +
        `🔖 Order: ${order.order_ref}\n` +
        `👤 You selected: <b>"I'm coming now"</b>\n\n` +
        `Kitchen has been notified! The staff will expect you shortly.`
      
      await editMessage(botToken, chatId, messageId, newText)
      console.log('✓ Message edited')
      
      await answerCallbackQuery(botToken, callbackId, '✓ Response recorded!', false)
      console.log('✓ Callback answered')
      
      console.log('========== SUCCESS ==========\n')
      return { ok: true, action: 'coming_now', orderId }
      
    } catch (error) {
      console.error('Error processing coming_now:', error)
      await answerCallbackQuery(botToken, callbackId, '❌ Error saving response', true)
      return { ok: false, error: error.message }
    }
    
  } else if (action === 'please_wait') {
    console.log('Processing: please_wait')
    
    try {
      await updateOrder(supabaseUrl, supabaseKey, orderId, { 
        customer_response_type: 'please_wait',
        customer_response_at: new Date().toISOString()
      })
      console.log('✓ Database updated')
      
      const newText = `✅ <b>Response Recorded</b>\n\n` +
        `🔖 Order: ${order.order_ref}\n` +
        `👤 You selected: <b>"Please wait"</b>\n\n` +
        `Kitchen has been notified. Take your time!`
      
      await editMessage(botToken, chatId, messageId, newText)
      console.log('✓ Message edited')
      
      await answerCallbackQuery(botToken, callbackId, '✓ Response recorded!', false)
      console.log('✓ Callback answered')
      
      console.log('========== SUCCESS ==========\n')
      return { ok: true, action: 'please_wait', orderId }
      
    } catch (error) {
      console.error('Error processing please_wait:', error)
      await answerCallbackQuery(botToken, callbackId, '❌ Error saving response', true)
      return { ok: false, error: error.message }
    }
    
  } else if (action === 'custom_message') {
    console.log('Processing: custom_message')
    
    try {
      await updateOrder(supabaseUrl, supabaseKey, orderId, { 
        awaiting_custom_message: true 
      })
      console.log('✓ Awaiting flag set')
      
      const newText = `✍️ <b>Send Your Custom Message</b>\n\n` +
        `🔖 Order: ${order.order_ref}\n\n` +
        `Please type your message to the kitchen staff.\n\n` +
        `Example: "I'll be there in 10 minutes"`
      
      await editMessage(botToken, chatId, messageId, newText)
      console.log('✓ Message edited')
      
      await answerCallbackQuery(botToken, callbackId, '✍️ Please type your message', false)
      console.log('✓ Callback answered')
      
      console.log('========== SUCCESS ==========\n')
      return { ok: true, action: 'custom_message', orderId }
      
    } catch (error) {
      console.error('Error processing custom_message:', error)
      await answerCallbackQuery(botToken, callbackId, '❌ Error', true)
      return { ok: false, error: error.message }
    }
  }
  
  console.log('Unknown action:', action)
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