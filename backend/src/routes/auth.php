<?php
declare(strict_types=1);

/**
 * Auth endpoints.
 *  - Cognito driver: registration/login happen browser→Cognito; this API only
 *    serves /auth/me (the synced profile) — unchanged from the original.
 *  - Local driver: the API owns the full lifecycle (register/login/refresh/
 *    change-password) using LocalAuth — no AWS required.
 *  - /auth/mode is public so the static frontend can discover the driver.
 */
return function (Router $r): void {
    $r->get('/auth/mode', function () {
        Http::json(['driver' => Auth::driver(), 'storage' => Storage::driver()]);
    });

    $r->get('/auth/me', function () {
        Http::json(['user' => Auth::authenticate()]);
    });

    $localOnly = function (): void {
        if (Auth::driver() !== 'local') {
            throw new HttpError(400, 'This endpoint is only available with AUTH_DRIVER=local (Cognito handles it otherwise)');
        }
    };

    $r->post('/auth/register', function () use ($localOnly) {
        $localOnly();
        $b = Http::body();
        $out = LocalAuth::register(
            Http::requireString($b, 'username'),
            Http::requireString($b, 'email'),
            Http::requireString($b, 'password'),
        );
        Http::json($out, 201);
    });

    $r->post('/auth/login', function () use ($localOnly) {
        $localOnly();
        $b = Http::body();
        Http::json(LocalAuth::login(
            Http::requireString($b, 'username'),
            Http::requireString($b, 'password'),
        ));
    });

    $r->post('/auth/refresh', function () use ($localOnly) {
        $localOnly();
        $b = Http::body();
        Http::json(LocalAuth::refresh(Http::requireString($b, 'refreshToken')));
    });

    $r->post('/auth/change-password', function () use ($localOnly) {
        $localOnly();
        $user = Auth::authenticate();
        $b = Http::body();
        LocalAuth::changePassword($user, Http::requireString($b, 'currentPassword'), Http::requireString($b, 'newPassword'));
        Http::noContent();
    });
};
