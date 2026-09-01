import { z } from "zod";

const RecordIdSchema = z.string().trim().min(1).max(240);
const RecordTextSchema = z.string().trim().min(1).max(240);
const RecordTimestampSchema = z.string().datetime({ offset: true });

/** The account-owned Channel Hub resource. It contains no provider grant. */
export const ChannelRecordSchema = z
  .object({
    id: RecordIdSchema,
    ownerId: RecordIdSchema,
    createdAt: RecordTimestampSchema,
  })
  .strict();

export type ChannelRecord = z.infer<typeof ChannelRecordSchema>;

/**
 * The account-owned authorization record. A read-only connection deliberately
 * has no write scope; publication authorization is a later user action.
 */
export const ChannelGrantRecordSchema = z
  .object({
    id: RecordIdSchema,
    ownerId: RecordIdSchema,
    channelId: RecordIdSchema,
    provider: z.literal("youtube"),
    providerSubject: RecordTextSchema,
    readScopeGranted: z.literal(true),
    writeScopeGranted: z.boolean(),
    status: z.enum(["active", "revoked"]),
    createdAt: RecordTimestampSchema,
  })
  .strict();

export type ChannelGrantRecord = z.infer<typeof ChannelGrantRecordSchema>;

/** One provider identity bound to exactly one grant and Channel resource. */
export const ConnectedChannelRecordSchema = z
  .object({
    id: RecordIdSchema,
    ownerId: RecordIdSchema,
    channelId: RecordIdSchema,
    grantId: RecordIdSchema,
    provider: z.literal("youtube"),
    providerChannelId: RecordTextSchema,
    displayName: RecordTextSchema,
    supportedCreator: z.literal(true),
    status: z.enum(["active", "revoked"]),
    createdAt: RecordTimestampSchema,
  })
  .strict();

export type ConnectedChannelRecord = z.infer<
  typeof ConnectedChannelRecordSchema
>;

export const ChannelConnectionSchema = z
  .object({
    channel: ChannelRecordSchema,
    grant: ChannelGrantRecordSchema,
    connectedChannel: ConnectedChannelRecordSchema,
    activeConnectedChannelId: RecordIdSchema,
  })
  .strict();

export type ChannelConnection = z.infer<typeof ChannelConnectionSchema>;

/**
 * Validate the cross-record invariants that a database transaction must also
 * enforce. Keeping this check at the domain seam prevents a future adapter
 * from accidentally treating the grant itself as the Channel identity.
 */
export function isCoherentChannelConnection(
  value: unknown,
): value is ChannelConnection {
  const parsed = ChannelConnectionSchema.safeParse(value);
  if (!parsed.success) return false;

  const { channel, grant, connectedChannel, activeConnectedChannelId } =
    parsed.data;
  return (
    channel.ownerId === grant.ownerId &&
    channel.ownerId === connectedChannel.ownerId &&
    channel.id === grant.channelId &&
    channel.id === connectedChannel.channelId &&
    grant.id === connectedChannel.grantId &&
    grant.provider === connectedChannel.provider &&
    grant.status === "active" &&
    connectedChannel.status === "active" &&
    activeConnectedChannelId === connectedChannel.id
  );
}

export type ChannelWorkBinding = Readonly<{
  ownerId: string;
  channelId: string;
  connectedChannelId: string;
  grantId: string;
  commentId: string;
  commentHash: string;
}>;
