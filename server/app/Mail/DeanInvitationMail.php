<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class DeanInvitationMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $collegeName,
        public readonly string $roleLabel,
        public readonly string $magicLink,
        public readonly int $expiresInHours = 48,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "You're invited to {$this->collegeName} on HIUSA",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.dean-invitation',
            text: 'emails.dean-invitation-text',
        );
    }
}
