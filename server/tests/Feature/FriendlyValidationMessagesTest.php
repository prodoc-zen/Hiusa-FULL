<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Validator;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FriendlyValidationMessagesTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_empty_sign_in_asks_for_the_email_or_school_id_and_the_password(): void
    {
        $response = $this->postJson('/api/login', [])->assertUnprocessable();

        $this->assertSame('Email or school ID is required.', $response->json('errors.identifier.0'));
        $this->assertSame('Password is required.', $response->json('errors.password.0'));
    }

    public function test_an_empty_password_reset_request_asks_for_the_email_or_school_id(): void
    {
        $response = $this->postJson('/api/password/forgot', [])->assertUnprocessable();

        $this->assertSame('Email or school ID is required.', $response->json('errors.identifier.0'));
    }

    public function test_a_file_that_is_too_large_is_refused_without_kilobytes_or_the_word_field(): void
    {
        $validator = Validator::make(
            ['image' => UploadedFile::fake()->create('big.png', 6000, 'image/png')],
            ['image' => ['image', 'max:5120']],
        );

        $message = $validator->errors()->first('image');

        $this->assertSame('The image must be 5 MB or smaller.', $message);
        $this->assertStringNotContainsString('kilobytes', $message);
    }

    public function test_a_small_file_limit_is_stated_in_kilobytes_and_other_max_messages_keep_their_numbers(): void
    {
        $validator = Validator::make(
            ['logo' => UploadedFile::fake()->create('big.png', 900, 'image/png'), 'title' => str_repeat('a', 11), 'seats' => 12],
            ['logo' => ['image', 'max:512'], 'title' => ['max:10'], 'seats' => ['integer', 'max:10']],
        );

        $this->assertSame('The logo must be 512 KB or smaller.', $validator->errors()->first('logo'));
        $this->assertSame('Title must not be longer than 10 characters.', $validator->errors()->first('title'));
        $this->assertSame('Seats must not be greater than 10.', $validator->errors()->first('seats'));
    }

    public function test_an_upload_endpoint_over_its_limit_names_the_limit_in_megabytes(): void
    {
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($admin);

        $response = $this->post('/api/announcements', [
            'title' => 'Notice', 'body' => 'Body', 'target_role' => 'all',
            'image' => UploadedFile::fake()->create('big.png', 6000, 'image/png'),
        ], ['Accept' => 'application/json'])->assertUnprocessable();

        $this->assertSame('The image must be 5 MB or smaller.', $response->json('errors.image.0'));
    }

    public function test_a_wrong_file_type_lists_the_types_that_are_allowed(): void
    {
        $validator = Validator::make(
            ['informative_letter' => UploadedFile::fake()->create('letter.docx', 10, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')],
            ['informative_letter' => ['file', 'mimes:pdf']],
        );

        $this->assertSame('The informative letter must be one of these file types: pdf.', $validator->errors()->first('informative_letter'));
    }

    public function test_a_supporting_document_error_names_the_document_not_the_array_position(): void
    {
        $validator = Validator::make(
            ['supporting_documents' => [UploadedFile::fake()->create('notes.exe', 10, 'application/octet-stream')]],
            ['supporting_documents.*' => ['file', 'mimes:pdf,jpg']],
        );

        $this->assertSame('The supporting document must be one of these file types: pdf, jpg.', $validator->errors()->first('supporting_documents.0'));
    }

    public function test_a_duplicate_and_a_wrong_format_read_as_plain_sentences(): void
    {
        $validator = Validator::make(
            ['contact_number' => 'abc', 'starts_on' => '2999-01-01'],
            ['contact_number' => ['regex:/^[0-9]+$/'], 'starts_on' => ['date', 'before_or_equal:today']],
        );

        $this->assertSame('Contact number is not in the right format.', $validator->errors()->first('contact_number'));
        $this->assertSame('Starts on must be on or before today.', $validator->errors()->first('starts_on'));
        $this->assertSame('That title is already in use.', trans('validation.unique', ['attribute' => 'title']));
    }
}
