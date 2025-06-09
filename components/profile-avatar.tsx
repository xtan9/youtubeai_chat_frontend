"use client";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

interface User {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

interface ProfileAvatarProps {
  user: User;
}

export function ProfileAvatar({ user }: ProfileAvatarProps) {
  // Get user initials for fallback
  const getInitials = (email: string) => {
    return email
      .split('@')[0]
      .split('.')
      .map(name => name.charAt(0).toUpperCase())
      .join('')
      .slice(0, 2);
  };

  // Get display name
  const getDisplayName = () => {
    if (user.user_metadata?.full_name) {
      return user.user_metadata.full_name;
    }
    return user.email?.split('@')[0] || 'User';
  };

  return (
    <div className="relative">
      <Avatar className="h-10 w-10 border-2 border-purple-400/50 hover:border-purple-400 transition-colors cursor-pointer">
        <AvatarImage 
          src={user.user_metadata?.avatar_url} 
          alt={getDisplayName()}
          className="object-cover"
        />
        <AvatarFallback className="bg-gradient-to-r from-purple-500 to-cyan-500 text-white text-sm font-medium">
          {getInitials(user.email || 'User')}
        </AvatarFallback>
      </Avatar>
      {/* Online indicator */}
      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-slate-900 rounded-full"></div>
    </div>
  );
} 