<?php

namespace Database\Seeders;

use App\Models\Merchandise;
use Illuminate\Database\Seeder;

class MerchandiseSeeder extends Seeder
{
    public function run(): void
    {
        $items = [
            [
                'name'           => 'HIUSA T-Shirt (S/M)',
                'category'       => 'Apparel',
                'description'    => 'Official HIUSA organization shirt. Light blue with embroidered HIUSA logo on the chest. Available in Small and Medium.',
                'price'          => 250.00,
                'stock_quantity' => 45,
                'is_active'      => true,
            ],
            [
                'name'           => 'HIUSA T-Shirt (L/XL)',
                'category'       => 'Apparel',
                'description'    => 'Official HIUSA organization shirt. Light blue with embroidered HIUSA logo on the chest. Available in Large and Extra-Large.',
                'price'          => 250.00,
                'stock_quantity' => 30,
                'is_active'      => true,
            ],
            [
                'name'           => 'HIUSA Tote Bag',
                'category'       => 'Accessories',
                'description'    => 'Reusable canvas tote bag with HIUSA logo print. Dimensions: 35cm × 38cm. Natural beige color.',
                'price'          => 180.00,
                'stock_quantity' => 20,
                'is_active'      => true,
            ],
            [
                'name'           => 'HIUSA Lanyard',
                'category'       => 'Accessories',
                'description'    => 'Durable polyester lanyard with HIUSA branding and metal clip. Standard length 45cm. Navy blue.',
                'price'          => 75.00,
                'stock_quantity' => 8,
                'is_active'      => true,
            ],
            [
                'name'           => 'HIUSA Notebook (A5)',
                'category'       => 'Stationery',
                'description'    => 'Soft-cover A5 ruled notebook with HIUSA logo on the cover. 120 pages. Currently out of stock — reorder in progress.',
                'price'          => 120.00,
                'stock_quantity' => 0,
                'is_active'      => true,
            ],
            [
                'name'           => 'HIUSA Cap',
                'category'       => 'Apparel',
                'description'    => 'Adjustable baseball cap with embroidered HIUSA logo. Navy blue. Currently delisted pending new design.',
                'price'          => 350.00,
                'stock_quantity' => 15,
                'is_active'      => false,
            ],
        ];

        foreach ($items as $item) {
            Merchandise::create($item);
        }
    }
}
