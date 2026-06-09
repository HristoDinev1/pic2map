<?php
declare(strict_types=1);

/**
 * Local-storage upload endpoint — the stand-in for S3's presigned PUT.
 * The browser PUTs the original to /uploads?token=… (token minted by
 * /photos/presign); we store the file and process it synchronously
 * (EXIF GPS + GD thumbnails → READY), replacing the Lambda.
 *
 * Media serving (GET /media/{key}) is handled in public/index.php before the
 * router because keys contain slashes the :param router can't express.
 */
return function (Router $r): void {
    $r->put('/uploads', function () {
        $token = Http::query('token');
        if ($token === null) throw new HttpError(401, 'Missing upload token');
        $claims = Token::verify($token);
        if (($claims['use'] ?? '') !== 'upload') throw new HttpError(401, 'Not an upload token');

        $key = Storage::assertSafeKey((string) ($claims['key'] ?? ''));
        $photoId = (string) ($claims['photoId'] ?? '');
        if ($photoId === '') throw new HttpError(400, 'Malformed upload token');

        $bytes = (string) file_get_contents('php://input');
        $max = Config::int('MAX_UPLOAD_BYTES', 50 * 1024 * 1024);
        if ($bytes === '') throw new HttpError(400, 'Empty upload body');
        if (strlen($bytes) > $max) throw new HttpError(413, 'File too large');

        Storage::putLocal($key, $bytes);
        $photo = ImageProcessor::process($photoId);
        $photo['owner_username'] = null;
        Http::json(['photo' => Serialize::photo($photo)]);
    });
};
