'use client';
import { AssistantChat } from '@/components/assistant/chat-core';

export default function AssistantPage() {
  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col">
      <div className="flex-1 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <AssistantChat variant="full" persistKey="leadforge_assistant_chat" />
      </div>
    </div>
  );
}
