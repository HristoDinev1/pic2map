<?php
declare(strict_types=1);

/** Converts a `photos` DB row into the API JSON shape, resolving S3 keys to URLs (mirrors lib/serialize.ts). */
final class Serialize
{
    public static function photo(array $p): array
    {
        return [
            'id' => $p['id'],
            'ownerId' => $p['owner_id'],
            'ownerUsername' => $p['owner_username'] ?? null,
            'title' => $p['title'],
            'description' => $p['description'],
            'urls' => [
                'original' => Storage::resolveUrl($p['s3_key_original'] ?? null),
                'thumb' => Storage::resolveUrl($p['s3_key_thumb'] ?? null),
                'medium' => Storage::resolveUrl($p['s3_key_medium'] ?? null),
                'large' => Storage::resolveUrl($p['s3_key_large'] ?? null),
            ],
            'contentType' => $p['content_type'],
            'sizeBytes' => $p['size_bytes'] !== null ? (int) $p['size_bytes'] : null,
            'width' => $p['width'] !== null ? (int) $p['width'] : null,
            'height' => $p['height'] !== null ? (int) $p['height'] : null,
            'latitude' => $p['latitude'] !== null ? (float) $p['latitude'] : null,
            'longitude' => $p['longitude'] !== null ? (float) $p['longitude'] : null,
            'capturedAt' => $p['captured_at'],
            'visibility' => $p['visibility'],
            'status' => $p['status'],
            'processState' => $p['process_state'],
            'processError' => $p['process_error'],
            'createdAt' => $p['created_at'],
            'updatedAt' => $p['updated_at'],
        ];
    }

    public static function photos(array $rows): array
    {
        return array_map([self::class, 'photo'], $rows);
    }
}
