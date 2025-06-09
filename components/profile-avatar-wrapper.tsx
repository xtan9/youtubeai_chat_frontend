"use client";

import { ProfileAvatar } from "./profile-avatar";

interface User {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

interface ProfileAvatarWrapperProps {
  user: User;
}

export function ProfileAvatarWrapper({ user }: ProfileAvatarWrapperProps) {
  return <ProfileAvatar user={user} />;
} 