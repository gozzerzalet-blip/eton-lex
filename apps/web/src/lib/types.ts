export type User = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
  username?: string | null;
  publicId?: string | null;
  university?: string | null;
  universityId?: string | null;
  campusId?: string | null;
  universityType?: 'publica' | 'privada' | null;
  faculty?: string | null;
  career?: string | null;
  country?: string | null;
  city?: string | null;
  cycle?: string | null;
  bio?: string | null;
  coverUrl?: string | null;
  links?: Array<{ label: string; url: string }>;
  privacyFields?: Record<string, 'everyone' | 'friends' | 'private'>;
  lastSeenAt?: string | null;
  role: 'student' | 'moderator' | 'admin';
  interests?: string[];
  friends?: number;
  createdAt?: string;
  theme?: 'dark' | 'light';
  onboarded?: boolean;
  emailVerified?: boolean;
  privacy?: { profile?: 'community' | 'friends' | 'private'; activity?: 'friends' | 'private' };
  bubbleColors?: { mine: string; other: string };
};

export type Norm = {
  id: string;
  slug: string;
  title: string;
  shortTitle?: string | null;
  number?: string | null;
  type: string;
  area?: string | null;
  areaName?: string | null;
  entity?: string | null;
  publishedAt?: string | null;
  effectiveAt?: string | null;
  status: string;
  officialUrl?: string | null;
  summary?: string | null;
  verification: 'pending' | 'verified' | 'mismatch';
  articleCount?: number;
};

export type Article = {
  id: string;
  number: string;
  heading?: string | null;
  text: string;
  order_index?: number;
  source_url?: string | null;
  book?: string | null;
  section?: string | null;
  title?: string | null;
  chapter?: string | null;
  status?: 'vigente' | 'modificado' | 'derogado' | string;
  provenance?: string | null;
  updated_at?: string;
};

export type TextStats = {
  articleCount: number;
  derogated: number;
  modified: number;
  gaps: string[];
  supplemented: string[];
};

export type NewsItem = {
  id: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  source_name: string;
  source_url: string;
  image_url?: string | null;
  scope: 'nacional' | 'internacional';
  category?: string | null;
  relevance?: string | null;
  published_at?: string | null;
  fetched_at?: string | null;
};

export type LegislativeUpdate = {
  id: string;
  type: string;
  title: string;
  summary?: string | null;
  previous_text?: string | null;
  current_text?: string | null;
  modifying_norm?: string | null;
  published_at?: string | null;
  detected_at?: string;
  source_url?: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  norm_title?: string | null;
  norm_slug?: string | null;
  norm_number?: string | null;
  article_number?: string | null;
  source_name?: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  body: string | null;
  kind: 'text' | 'image' | 'file' | 'audio' | 'link' | 'norm' | 'news';
  createdAt: string;
  editedAt?: string | null;
  deleted: boolean;
  sender: { id: string; name: string; avatarUrl?: string | null };
  attachment?: { id: string; name: string; mime: string; size: number } | null;
  replyTo?: { id: string; body: string | null; kind: string; sender_name: string } | null;
  reactions: Array<{ emoji: string; count: number; users: string[] }>;
  oneTime?: boolean;
  viewed?: boolean;
  stickerPack?: string | null;
};

export type Conversation = {
  id: string;
  type: 'direct' | 'group';
  title: string;
  avatarUrl?: string | null;
  members: Array<{ id: string; name: string; avatarUrl?: string | null; university?: string | null; role: string; lastReadAt?: string | null }>;
  lastMessage: Message | null;
  unread: number;
  lastMessageAt?: string | null;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
};

export type AiCitation = {
  ref: string;
  label: string;
  kind: string;
  url?: string | null;
  normId?: string | null;
  articleId?: string | null;
  newsId?: string | null;
  slug?: string | null;
  articleNumber?: string | null;
  official?: boolean | null;
  publishedAt?: string | null;
};

export type AiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations: AiCitation[];
  sources?: Array<{ label: string; url?: string | null; kind: string }>;
  model?: string | null;
  latencyMs?: number | null;
  createdAt?: string;
};

export type Post = {
  id: string;
  kind: string;
  title?: string | null;
  body?: string | null;
  refType?: string | null;
  refId?: string | null;
  visibility: string;
  createdAt: string;
  groupId?: string | null;
  author: { id: string; name: string; avatarUrl?: string | null; university?: string | null };
  likes: number;
  comments: number;
  liked: boolean;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  priority: string;
  read_at?: string | null;
  created_at: string;
};
