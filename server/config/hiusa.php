<?php

return [

    /*
    | The version of the Data Privacy Notice a person agreed to is stored next to the time they agreed. Change this
    | when the notice changes in a way people should read again, and update client/src/pages/auth/PrivacyNoticePage.jsx.
    */
    'privacy_notice_version' => '2026-11',

    /*
    | An order that nobody has paid for lapses after this many days. Read by Order::unpaidExpiryDays().
    */
    'orders' => ['unpaid_expiry_days' => 5],

];
