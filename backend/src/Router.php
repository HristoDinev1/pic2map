<?php
declare(strict_types=1);

/** Tiny path-based router (stand-in for Express's Router): matches "/segment/:param" patterns. */
final class Router
{
    /** @var array<int, array{method: string, regex: string, names: string[], handler: callable}> */
    private array $routes = [];

    private function add(string $method, string $pattern, callable $handler): void
    {
        $names = [];
        $regex = preg_replace_callback('#:([A-Za-z_][A-Za-z0-9_]*)#', function ($m) use (&$names) {
            $names[] = $m[1];
            return '([^/]+)';
        }, $pattern);
        $this->routes[] = ['method' => $method, 'regex' => '#^' . $regex . '$#', 'names' => $names, 'handler' => $handler];
    }

    public function get(string $pattern, callable $handler): void { $this->add('GET', $pattern, $handler); }
    public function post(string $pattern, callable $handler): void { $this->add('POST', $pattern, $handler); }
    public function patch(string $pattern, callable $handler): void { $this->add('PATCH', $pattern, $handler); }
    public function put(string $pattern, callable $handler): void { $this->add('PUT', $pattern, $handler); }
    public function delete(string $pattern, callable $handler): void { $this->add('DELETE', $pattern, $handler); }

    /** Finds and invokes the matching handler with (array $params). Returns true if a route matched. */
    public function dispatch(string $method, string $path): bool
    {
        foreach ($this->routes as $route) {
            if ($route['method'] !== $method) continue;
            if (!preg_match($route['regex'], $path, $m)) continue;
            $params = [];
            foreach ($route['names'] as $i => $name) $params[$name] = $m[$i + 1];
            ($route['handler'])($params);
            return true;
        }
        return false;
    }
}
