<?php
declare(strict_types=1);

/**
 * Registration / login / password reset are handled by Cognito (browser SDK +
 * direct Cognito API calls from the frontend). This endpoint just returns the
 * synced profile for the currently authenticated token — port of routes/auth.ts.
 */
return function (Router $r): void {
    $r->get('/auth/me', function () {
        Http::json(['user' => Auth::authenticate()]);
    });
};
