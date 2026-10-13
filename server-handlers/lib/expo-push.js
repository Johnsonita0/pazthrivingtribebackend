export async function sendCustomerChatPush(supabase, { customerId, title, body, conversationId }) {
  if (!customerId) return { sent: false, reason: 'not-account-linked' };
  const { data: profile, error } = await supabase.from('customer_profiles')
    .select('expo_push_token')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw error;
  const token = profile?.expo_push_token;
  if (!token) return { sent: false, reason: 'no-device-token' };

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {})
    },
    body: JSON.stringify({
      to: token,
      sound: 'default',
      title,
      body,
      data: { type: 'product-chat', conversationId }
    })
  });
  const result = await response.json().catch(() => ({}));
  const tickets = Array.isArray(result?.data) ? result.data : [result?.data];
  const failedTicket = tickets.find((ticket) => ticket?.status === 'error');
  if (!response.ok || failedTicket) {
    throw new Error(failedTicket?.message || result?.errors?.[0]?.message || `Expo push returned HTTP ${response.status}.`);
  }
  return { sent: true };
}
