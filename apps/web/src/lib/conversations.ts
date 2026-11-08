import type { ConversationDto } from '@ronto/api'

export function conversationTitle(conversation: ConversationDto) {
  return conversation.title ?? 'New conversation'
}
