<?php

namespace App\Services;

use Illuminate\Support\Facades\Crypt;

class FingerprintTemplateService
{
    public function encrypt(string $template): string
    {
        return Crypt::encryptString($template);
    }

    public function decrypt(string $encryptedTemplate): string
    {
        return Crypt::decryptString($encryptedTemplate);
    }
}
