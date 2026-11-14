<?php

namespace App\Services\Ai;

use GuzzleHttp\Client as GuzzleClient;
use GuzzleHttp\Psr7\StreamDecoratorTrait;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\StreamInterface;

/**
 * Puts a wall-clock end on a streamed response. The HTTP transport's timeout is per read and the SDK skips
 * ping events, so without this a stream that keeps trickling bytes would never be stopped.
 */
final class DeadlineTransporter implements ClientInterface
{
    public function __construct(private readonly ClientInterface $inner, private readonly float $deadline) {}

    public function sendRequest(RequestInterface $request): ResponseInterface
    {
        // Same opt-in the SDK's own streaming client gives a Guzzle transport; without it the body is read whole.
        $response = $this->inner instanceof GuzzleClient
            ? $this->inner->send($request, ['stream' => true, 'http_errors' => false, 'allow_redirects' => false])
            : $this->inner->sendRequest($request);
        $deadline = $this->deadline;

        return $response->withBody(new class($response->getBody(), $deadline) implements StreamInterface
        {
            use StreamDecoratorTrait;

            private StreamInterface $stream;

            public function __construct(StreamInterface $stream, private readonly float $deadline)
            {
                $this->stream = $stream;
            }

            public function read($length): string
            {
                if (microtime(true) > $this->deadline) {
                    throw new \RuntimeException('Chat deadline reached.');
                }

                return $this->stream->read($length);
            }
        });
    }
}
