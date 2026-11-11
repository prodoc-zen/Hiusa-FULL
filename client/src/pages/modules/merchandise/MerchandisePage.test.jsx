import { findRowAction } from '../../../test/rowActions';
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import MerchandisePage from "./MerchandisePage";

const merchandiseMocks = vi.hoisted(() => ({
  getMerchandise: vi.fn(),
  getGcashSettings: vi.fn(),
  uploadGcashQr: vi.fn(),
  adjustStock: vi.fn(),
  getMerchandiseAuditLogs: vi.fn(),
  deleteItem: vi.fn(),
}));
const orderMocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
  getOrder: vi.fn(),
  cancelOrder: vi.fn(),
  placeOrder: vi.fn(),
  verifyClaimToken: vi.fn(),
  claimByToken: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock("../../../services/merchandiseService", () => ({
  ...merchandiseMocks,
  createItem: vi.fn(),
  updateItem: vi.fn(),
  adjustStock: merchandiseMocks.adjustStock,
  getMerchandiseAuditLogs: merchandiseMocks.getMerchandiseAuditLogs,
}));

vi.mock("../../../services/orderService", () => ({
  ...orderMocks,
  exportOrders: vi.fn(),
  getOrderAnalyticsUsers: vi.fn(),
  getOrderAuditLogs: vi.fn(),
  openOrderPaymentProof: vi.fn(),
  placeOrder: orderMocks.placeOrder,
  submitOrderPayment: vi.fn(),
  updateOrderStatus: orderMocks.updateOrderStatus,
  claimByToken: orderMocks.claimByToken,
  verifyClaimToken: orderMocks.verifyClaimToken,
}));

vi.mock("../../../services/pagination", () => ({
  fetchAllPages: vi.fn(async (loader) => {
    const response = await loader({ page: 1, per_page: 100 });
    return Array.isArray(response) ? response : response?.data || [];
  }),
}));

const products = [
  {
    id: 1,
    name: "HIUSA Shirt",
    category: "Apparel",
    description: "Official organization shirt",
    price: "350.00",
    stock_quantity: 8,
    is_active: true,
    image_url: null,
  },
  {
    id: 2,
    name: "HIUSA Lanyard",
    category: "Accessories",
    description: "Official organization lanyard",
    price: "100.00",
    stock_quantity: 0,
    is_active: true,
    image_url: null,
  },
];

function paginatedOrders(rows = []) {
  return {
    data: rows,
    current_page: 1,
    last_page: 1,
    total: rows.length,
    per_page: 10,
  };
}

describe("MerchandisePage buyer experience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("user", JSON.stringify({ school_id: 910001, role: "STUDENT" }));
    merchandiseMocks.getMerchandise.mockResolvedValue({
      data: { data: products, current_page: 1, last_page: 1 },
    });
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
  });

  it("shows exact stock, keeps sold-out products visible, and filters categories", async () => {
    render(
      <MemoryRouter>
        <MerchandisePage initialTab="order" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("8 in stock")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Currently unavailable" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Filter merchandise category"), {
      target: { value: "Accessories" },
    });
    expect(screen.queryByText("HIUSA Shirt")).not.toBeInTheDocument();
    expect(screen.getByText("HIUSA Lanyard")).toBeInTheDocument();
  });

  it("lets the buyer confirm cancellation of an eligible pending order", async () => {
    const pendingOrder = {
      id: 17,
      merchandise: products[0],
      quantity: 1,
      total_price: "350.00",
      payment_method: "cash",
      payment_proof_url: null,
      payment_reference: null,
      officer_review_status: "pending",
      admin_review_status: "pending",
      status: "pending",
      claim_token: null,
      created_at: "2026-09-13T10:00:00Z",
    };
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([pendingOrder]) });
    orderMocks.cancelOrder.mockResolvedValue({
      data: {
        ...pendingOrder,
        status: "cancelled",
        review_remarks: "Cancelled by buyer.",
      },
    });

    render(
      <MemoryRouter>
        <MerchandisePage initialTab="my-orders" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    expect(screen.getByRole("heading", { name: "Cancel this order?" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel order" }).at(-1));

    await waitFor(() => expect(orderMocks.cancelOrder).toHaveBeenCalledWith(17));
    expect(await screen.findByText("Cancelled by buyer.")).toBeInTheDocument();
  });

  it("tells the buyer cancelling releases the held stock and never says the order has not reserved stock", async () => {
    const pendingOrder = {
      id: 18,
      merchandise: products[0],
      quantity: 1,
      total_price: "350.00",
      payment_method: "cash",
      payment_proof_url: null,
      payment_reference: null,
      officer_review_status: "pending",
      admin_review_status: "pending",
      status: "pending",
      claim_token: null,
      created_at: "2026-09-13T10:00:00Z",
    };
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([pendingOrder]) });

    render(
      <MemoryRouter>
        <MerchandisePage initialTab="my-orders" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Cancelling it releases the stock held for this order\./)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/has not reserved stock/i);
  });

  it("opens product details with stock and adds the chosen quantity to the cart", async () => {
    render(<MemoryRouter><MerchandisePage initialTab="order" /></MemoryRouter>);
    await screen.findByText("HIUSA Shirt");
    fireEvent.click(screen.getAllByRole('button', { name: 'View product details' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('8 units in stock')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to cart' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/2 x HIUSA Shirt added to cart/)).toBeInTheDocument();
  });

  it("says Only N available under the quantity box when a typed amount is cut down to the stock", async () => {
    render(<MemoryRouter><MerchandisePage initialTab="order" /></MemoryRouter>);
    await screen.findByText("HIUSA Shirt");
    const box = screen.getByLabelText("Quantity for HIUSA Shirt");

    fireEvent.change(box, { target: { value: "99" } });
    expect(box).toHaveValue(8);
    expect(screen.getByRole("alert")).toHaveTextContent("Only 8 available.");

    fireEvent.change(box, { target: { value: "3" } });
    expect(box).toHaveValue(3);
    expect(screen.queryByText("Only 8 available.")).not.toBeInTheDocument();
  });

  it("says Only N available in the product details when the typed quantity is cut down to the stock", async () => {
    render(<MemoryRouter><MerchandisePage initialTab="order" /></MemoryRouter>);
    await screen.findByText("HIUSA Shirt");
    fireEvent.click(screen.getAllByRole('button', { name: 'View product details' })[0]);
    const dialog = screen.getByRole('dialog');
    const box = within(dialog).getByLabelText('Quantity');

    fireEvent.change(box, { target: { value: '99' } });
    expect(box).toHaveValue(8);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Only 8 available.');

    fireEvent.change(box, { target: { value: '2' } });
    expect(within(dialog).queryByText('Only 8 available.')).not.toBeInTheDocument();
  });

  it("shows a limited promotion, requires a variant, and opens product images", async () => {
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: [{
      ...products[0], image_url: "/uploads/merchandise/shirt.jpg",
      variants: [{ id: 11, name: "XL", stock_quantity: 2, image_url: "/uploads/merchandise/xl.jpg" }],
      promotion_price: "250.00", effective_price: "250.00", promotion_buyer_limit: 100,
      promotion_remaining: 12, promotion_available_to_viewer: true, is_low_stock: true,
    }], current_page: 1, last_page: 1 } });
    render(<MemoryRouter><MerchandisePage initialTab="order" /></MemoryRouter>);
    expect(await screen.findByText("First 100 buyers")).toBeInTheDocument();
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(screen.getByText("Select a variant for HIUSA Shirt.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Select variant for HIUSA Shirt" }), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(screen.getByText(/1 x HIUSA Shirt added to cart/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View HIUSA Shirt images" }));
    expect(screen.getByRole("img", { name: "HIUSA Shirt image 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("img", { name: "HIUSA Shirt image 2" })).toBeInTheDocument();
  });

  it("shows a printable claim ticket in My Orders without the shop summary tiles", async () => {
    const paidOrder = { id: 29, merchandise: products[0], quantity: 1, total_price: "350.00", status: "paid", claim_token: "CLAIMTOKEN123456", created_at: "2026-09-13T10:00:00Z" };
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([paidOrder]) });
    render(<MemoryRouter><MerchandisePage initialTab="my-orders" /></MemoryRouter>);
    expect(await screen.findByText(/Merchandise claim ticket/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print ticket" })).toBeInTheDocument();
    expect(screen.queryByText("Available items")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /My cart/ })).not.toBeInTheDocument();
  });

  it("opens the cart from one row in the shop, only when the cart has items", async () => {
    render(<MemoryRouter><MerchandisePage initialTab="order" /></MemoryRouter>);
    await screen.findByText("HIUSA Shirt");
    expect(screen.queryByRole("button", { name: "View cart" })).not.toBeInTheDocument();
    expect(screen.queryByText("Available items")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Add to cart" })[0]);
    expect(screen.getByText(/1 item in your cart/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View cart" }));
    expect(await screen.findByRole("button", { name: "Review and continue" })).toBeInTheDocument();
  });

  it("gives every card a stock count and no grey placeholder tile", async () => {
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: [
      { ...products[0], is_low_stock: true },
      { ...products[1], stock_quantity: 20, name: "HIUSA Pen" },
    ], current_page: 1, last_page: 1 } });
    const { container } = render(<MemoryRouter><MerchandisePage initialTab="order" /></MemoryRouter>);
    await screen.findByText("HIUSA Shirt");
    expect(screen.getByText("8 in stock")).toBeInTheDocument();
    expect(screen.getByText("20 in stock")).toBeInTheDocument();
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    expect(container.querySelector(".lucide-package")).toBeNull();
  });
});

describe("MerchandisePage fulfillment experience", () => {
  const paidOrder = {
    id: 28,
    merchandise: products[0],
    student: {
      school_id: 2200451,
      first_name: "Rafael",
      last_name: "Aquino",
      role: "STUDENT",
      program: "BS Information Technology",
      year_level: "4th Year",
      section: "4-A",
    },
    quantity: 1,
    total_price: "350.00",
    payment_method: "gcash",
    payment_reference: "1234567890123",
    officer_review_status: "approved",
    admin_review_status: "approved",
    status: "paid",
    claim_token: "CLAIMTOKEN123456",
    created_at: "2026-09-13T10:00:00Z",
  };

  function managerOrdersResponse() {
    return {
      data: {
        ...paginatedOrders([paidOrder]),
        summary: {
          total_users: 1,
          purchased_users: 1,
          not_purchased_users: 0,
          purchase_rate: 100,
          paid_orders: 1,
          pending_orders: 0,
          claimed_orders: 0,
          unclaimed_orders: 1,
          total_collected: 350,
          outstanding_balance: 0,
          breakdown: [],
        },
        filter_options: {
          departments: [],
          programs: [],
          majors: [],
          roles: ["STUDENT"],
          positions: [],
          merchandise: products,
          statuses: ["pending", "paid", "claimed", "cancelled"],
          payment_statuses: ["pending", "paid", "cancelled"],
          payment_methods: ["cash", "gcash"],
        },
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("user", JSON.stringify({ school_id: 100001, role: "ADMIN" }));
    merchandiseMocks.getMerchandise.mockResolvedValue({
      data: { data: products, current_page: 1, last_page: 1 },
    });
    orderMocks.getOrders.mockResolvedValue(managerOrdersResponse());
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
  });

  it("shows an approved order's claim token in the modern order queue", async () => {
    render(
      <MemoryRouter>
        <MerchandisePage initialTab="orders" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Order queue" })).toBeInTheDocument();
    expect(screen.getAllByText("Ready for pickup").length).toBeGreaterThan(0);
    expect((await screen.findAllByText("CLAIMTOKEN123456")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rafael Aquino").length).toBeGreaterThan(0);
  });

  it("opens admin payment settings on demand and returns focus to the queue", async () => {
    render(<MemoryRouter><MerchandisePage initialTab="orders" /></MemoryRouter>);
    await screen.findAllByText("CLAIMTOKEN123456");
    expect(screen.queryByLabelText("Official GCash QR image")).not.toBeInTheDocument();
    expect(merchandiseMocks.getGcashSettings).not.toHaveBeenCalled();

    const trigger = screen.getByRole("button", { name: "Payment settings" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "GCash payment settings" });
    expect(await within(dialog).findByText("No QR code uploaded")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Official GCash QR image")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save GCash QR" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose a QR image to upload.");
    expect(merchandiseMocks.uploadGcashQr).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps payment settings open until the QR upload completes", async () => {
    let finishUpload;
    merchandiseMocks.uploadGcashQr.mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    const OriginalURL = globalThis.URL;
    vi.stubGlobal("URL", class extends OriginalURL {
      static createObjectURL() { return "blob:gcash-preview"; }
      static revokeObjectURL() {}
    });
    try {
      render(<MemoryRouter><MerchandisePage initialTab="orders" /></MemoryRouter>);
      fireEvent.click(screen.getByRole("button", { name: "Payment settings" }));
      const dialog = screen.getByRole("dialog", { name: "GCash payment settings" });
      await waitFor(() => expect(merchandiseMocks.getGcashSettings).toHaveBeenCalled());
      const qr = new File(["qr-image"], "official-qr.png", { type: "image/png" });
      fireEvent.change(within(dialog).getByLabelText("Official GCash QR image"), { target: { files: [qr] } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Save GCash QR" }));
      expect(merchandiseMocks.uploadGcashQr).toHaveBeenCalledWith(qr);
      expect(within(dialog).getByRole("button", { name: "Uploading..." })).toBeDisabled();
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Close modal" }));
      expect(dialog).toBeInTheDocument();

      await act(async () => finishUpload({ data: { gcash_qr_url: "/storage/official-qr.png" } }));
      expect(within(dialog).getByRole("img", { name: "Current official GCash payment QR code" })).toHaveAttribute("src", expect.stringContaining("/storage/official-qr.png"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Close modal" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets officers view the QR without exposing upload controls", async () => {
    localStorage.setItem("user", JSON.stringify({ school_id: 100002, role: "SBO_OFFICER" }));
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: "/storage/qr.png" } });
    render(<MemoryRouter><MerchandisePage initialTab="orders" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "View GCash QR" }));
    const dialog = screen.getByRole("dialog", { name: "GCash payment QR" });
    expect(await within(dialog).findByRole("img", { name: "Current official GCash payment QR code" })).toHaveAttribute("src", expect.stringContaining("/storage/qr.png"));
    expect(within(dialog).queryByLabelText("Official GCash QR image")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Save GCash QR" })).not.toBeInTheDocument();
  });

  it("combines status views with search and clears the active filters", async () => {
    render(<MemoryRouter><MerchandisePage initialTab="orders" /></MemoryRouter>);
    await screen.findAllByText("CLAIMTOKEN123456");
    const views = within(screen.getByRole("group", { name: "Filter orders by status" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search merchandise orders" }), { target: { value: "Rafael" } });
    fireEvent.click(views.getByRole("button", { name: "Ready for pickup" }));
    await waitFor(() => expect(orderMocks.getOrders).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: "paid", search: "Rafael" })));
    expect(views.getByRole("button", { name: "Ready for pickup" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
    expect(screen.getByRole("button", { name: /More filters/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Program or course" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    await waitFor(() => expect(orderMocks.getOrders).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: "", search: "" })));
    expect(views.getByRole("button", { name: "All orders" })).toHaveAttribute("aria-pressed", "true");
  });

  it("loads all paid and claimed orders in the token validation queue", async () => {
    render(
      <MemoryRouter>
        <MerchandisePage initialTab="tokens" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Release an order" })).toBeInTheDocument();
    expect((await screen.findAllByText(/Aquino/)).length).toBeGreaterThan(0);
    expect(screen.queryByText("CLAIMTOKEN123456")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(orderMocks.getOrders).toHaveBeenCalledWith(
        expect.objectContaining({ status: "claimable", sort: "oldest" }),
      ),
    );
  });

  it("previews a token before the officer can release the order", async () => {
    orderMocks.verifyClaimToken.mockResolvedValue({ data: paidOrder });
    orderMocks.claimByToken.mockResolvedValue({ data: { ...paidOrder, status: "claimed" } });
    render(<MemoryRouter><MerchandisePage initialTab="tokens" /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("16-character claim token"), { target: { value: paidOrder.claim_token } });
    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(orderMocks.verifyClaimToken).toHaveBeenCalledWith(paidOrder.claim_token));
    expect(orderMocks.claimByToken).not.toHaveBeenCalled();
    expect(await screen.findByText("Verify purchaser and release")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm release" }));
    await waitFor(() => expect(orderMocks.claimByToken).toHaveBeenCalledWith(paidOrder.claim_token));
  });

  it("shows purchaser and order details before payment approval and approves them with one click", async () => {
    const pendingOrder = { ...paidOrder, status: "pending", claim_token: null, unit_price: "250.00", total_price: "250.00", payment_method: "cash" };
    const response = managerOrdersResponse();
    response.data.data = [pendingOrder];
    orderMocks.getOrders.mockResolvedValue(response);
    orderMocks.updateOrderStatus.mockResolvedValue({ data: { ...pendingOrder, status: "paid", claim_token: "CLAIMTOKEN123456" } });
    render(<MemoryRouter><MerchandisePage initialTab="orders" /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole("button", { name: 'Review', exact: true }))[0]);
    const reviewDialog = screen.getByRole('dialog', { name: 'Merchandise order details' });
    expect(reviewDialog).toHaveTextContent("Rafael Aquino");
    expect(reviewDialog).toHaveTextContent("BS Information Technology");
    expect(reviewDialog).toHaveTextContent("250.00");
    expect(reviewDialog).toHaveTextContent("ORD-28");
    fireEvent.click(within(reviewDialog).getByRole('button', { name: 'Approve payment' }));
    await waitFor(() => expect(orderMocks.updateOrderStatus).toHaveBeenCalledTimes(1));
    expect(orderMocks.updateOrderStatus).toHaveBeenCalledWith(28, "paid", null, 250);
    expect(screen.queryByRole("dialog", { name: "Verify merchandise payment" })).not.toBeInTheDocument();
  });

  it("keeps the amount check for an officer verifying a payment from the order details", async () => {
    localStorage.setItem("user", JSON.stringify({ school_id: 100002, role: "SBO_OFFICER" }));
    const pendingOrder = { ...paidOrder, status: "pending", claim_token: null, unit_price: "250.00", total_price: "250.00", payment_method: "cash", officer_review_status: "pending", admin_review_status: "pending" };
    const response = managerOrdersResponse();
    response.data.data = [pendingOrder];
    orderMocks.getOrders.mockResolvedValue(response);
    render(<MemoryRouter><MerchandisePage initialTab="orders" /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole("button", { name: 'Review', exact: true }))[0]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Merchandise order details' })).getByRole('button', { name: 'Verify payment' }));
    expect(orderMocks.updateOrderStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Verify merchandise payment" })).toHaveTextContent("ORD-28");
  });

  it("shows inventory top sellers from paid sales and requires a stock note", async () => {
    const summary = managerOrdersResponse();
    summary.data.summary.breakdown = [{ id: 1, name: "HIUSA Shirt", quantity: 4, collected: 1400 }];
    orderMocks.getOrders.mockResolvedValue(summary);
    merchandiseMocks.adjustStock.mockResolvedValue({ data: { ...products[0], stock_quantity: 10 } });
    render(<MemoryRouter><MerchandisePage initialTab="inventory" /></MemoryRouter>);
    expect(await screen.findByText("Top sellers")).toBeInTheDocument();
    expect(await screen.findByText(/1,400\.00 collected/)).toBeInTheDocument();
    fireEvent.click(await findRowAction("Add stock"));
    fireEvent.change(screen.getByPlaceholderText("e.g. New delivery received"), { target: { value: "New delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Confirm stock addition" })).getByRole("button", { name: "Add stock" }));
    await waitFor(() => expect(merchandiseMocks.adjustStock).toHaveBeenCalledWith(1, 1, "New delivery", null));
  });
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}{location.search}</p>;
}

function renderAt(entry, initialTab) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <MerchandisePage initialTab={initialTab} />
    </MemoryRouter>,
  );
}

const buyerOrder = (overrides) => ({
  merchandise: products[0],
  quantity: 1,
  total_price: "350.00",
  payment_method: "cash",
  payment_proof_url: null,
  payment_reference: null,
  officer_review_status: "pending",
  admin_review_status: "pending",
  status: "pending",
  claim_token: null,
  created_at: "2026-09-13T10:00:00Z",
  ...overrides,
});

const progress = (id) => screen.getAllByRole("progressbar", { name: `ORD-${id} progress` })[0];

describe("MerchandisePage order stages for the buyer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("user", JSON.stringify({ school_id: 910001, role: "STUDENT" }));
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: products, current_page: 1, last_page: 1 } });
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: "/storage/qr.png" } });
  });

  it("puts every order status on the four step order stepper with its next action", async () => {
    orderMocks.getOrders.mockResolvedValue({
      data: paginatedOrders([
        buyerOrder({ id: 1 }),
        buyerOrder({ id: 2, payment_method: "gcash", payment_proof_url: "proofs/2.jpg", payment_reference: "1234567890123" }),
        buyerOrder({ id: 3, status: "paid", claim_token: "CLAIMTOKEN123456" }),
        buyerOrder({ id: 4, status: "claimed", claim_token: "CLAIMTOKEN654321", claimed_at: "2026-09-20T10:00:00Z" }),
        buyerOrder({ id: 5, status: "cancelled", review_remarks: "Out of stock." }),
      ]),
    });
    renderAt("/dashboard/merchandise/my-orders", "my-orders");

    await screen.findByText("Pay cash at pickup, or submit GCash proof");
    expect(progress(1)).toHaveAttribute("aria-valuetext", "Step 1 of 4: Reserved");
    expect(progress(2)).toHaveAttribute("aria-valuetext", "Step 2 of 4: Payment check");
    expect(screen.getAllByText("Waiting for payment check").length).toBeGreaterThan(0);
    expect(progress(3)).toHaveAttribute("aria-valuetext", "Step 3 of 4: Paid");
    expect(screen.getByText("Show token CLAIMTOKEN123456 at the claim desk")).toBeInTheDocument();
    expect(progress(4)).toHaveAttribute("aria-valuetext", "Complete: 4 of 4 steps done");
    expect(screen.getByText(/^Collected on /)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "ORD-5 progress" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Out of stock.")).toBeInTheDocument();
  });

  it("tells a buyer an officer verified the payment and that the Admin approves before the token is issued", async () => {
    orderMocks.getOrders.mockResolvedValue({
      data: paginatedOrders([buyerOrder({ id: 6, officer_review_status: "approved" })]),
    });
    renderAt("/dashboard/merchandise/my-orders", "my-orders");

    expect((await screen.findAllByText("Payment verified: waiting for Admin approval")).length).toBeGreaterThan(0);
    expect(progress(6)).toHaveAttribute("aria-valuetext", "Step 2 of 4: Payment check");
    expect(screen.queryByText("Pay cash at pickup, or submit GCash proof")).not.toBeInTheDocument();
    expect(screen.queryByText(/Show token/)).not.toBeInTheDocument();
  });

  it("tells a buyer there is no online payment instead of offering GCash", async () => {
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 1 })]) });
    renderAt("/dashboard/merchandise/my-orders", "my-orders");

    expect(await screen.findByText("Pay cash at pickup")).toBeInTheDocument();
    expect(screen.getAllByText("Online payment is not available. Pay cash at pickup.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Submit GCash proof" })).not.toBeInTheDocument();
  });

  it("says so on the shop when GCash is not set up and not when it is", async () => {
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
    const first = renderAt("/dashboard/merchandise/order-merchandise", "order");
    expect(await screen.findByText("Online payment is not available. Pay cash at pickup.")).toBeInTheDocument();
    first.unmount();

    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: "/storage/qr.png" } });
    renderAt("/dashboard/merchandise/order-merchandise", "order");
    await screen.findByText("HIUSA Shirt");
    expect(screen.queryByText("Online payment is not available. Pay cash at pickup.")).not.toBeInTheDocument();
  });

  it("opens an order's detail from ?record= with the full stepper and closes it", async () => {
    orderMocks.getOrders.mockResolvedValue({
      data: paginatedOrders([buyerOrder({ id: 3, status: "paid", claim_token: "CLAIMTOKEN123456" }), buyerOrder({ id: 4 })]),
    });
    renderAt("/dashboard/merchandise/my-orders?record=3", "my-orders");

    const dialog = await screen.findByRole("dialog", { name: "ORD-3" });
    const steps = within(dialog).getByRole("list", { name: "ORD-3 progress" });
    const current = within(steps).getAllByRole("listitem").find((step) => step.getAttribute("aria-current") === "step");
    expect(current).toHaveTextContent("Paid");
    expect(within(dialog).getByText("Show token CLAIMTOKEN123456 at the claim desk")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/dashboard\/merchandise\/my-orders$/);
  });

  it("shows which size was ordered on the My orders card and in its details", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 8, variant_name: "M", quantity: 1 }), buyerOrder({ id: 9, merchandise: products[1] })]) });
    renderAt("/dashboard/merchandise/my-orders", "my-orders");

    const card = (await screen.findByText("ORD-8")).closest("div.min-w-0");
    expect(card).toHaveTextContent("M · Qty: 1");
    expect(screen.getByText("ORD-9").closest("div.min-w-0")).not.toHaveTextContent("Size");
    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "ORD-8" });
    expect(within(dialog).getByText("Size")).toBeInTheDocument();
    expect(within(dialog).getByText("M")).toBeInTheDocument();
  });

  it("pushes ?record= when a row is opened and returns to the list on close", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 4 })]) });
    renderAt("/dashboard/merchandise/my-orders", "my-orders");

    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    expect(await screen.findByRole("dialog", { name: "ORD-4" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("?record=4");

    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).not.toHaveTextContent("record=");
  });

  it("reports an unknown ?record= instead of opening an empty panel", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 4 })]) });
    orderMocks.getOrder.mockRejectedValue({ response: { status: 404 } });
    renderAt("/dashboard/merchandise/my-orders?record=999", "my-orders");

    expect(await screen.findByText("ORD-999 was not found in your orders.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("record="));
  });

  it("opens a buyer's own order from ?record= when it is not on the loaded page", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 4 })]) });
    orderMocks.getOrder.mockResolvedValue({ data: buyerOrder({ id: 77, status: "paid", claim_token: "CLAIMTOKEN123456" }) });
    renderAt("/dashboard/merchandise/my-orders?record=77", "my-orders");

    expect(await screen.findByRole("dialog", { name: "ORD-77" })).toBeInTheDocument();
    expect(orderMocks.getOrder).toHaveBeenCalledWith("77");
  });

  it("does not read the order separately when it is already on the loaded page", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 3 })]) });
    renderAt("/dashboard/merchandise/my-orders?record=3", "my-orders");

    expect(await screen.findByRole("dialog", { name: "ORD-3" })).toBeInTheDocument();
    expect(orderMocks.getOrder).not.toHaveBeenCalled();
  });

  it("says one consistent thing about held stock in the cart and the checkout modal", async () => {
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
    localStorage.setItem("hiusa_student_cart", JSON.stringify([{ item: { ...products[0] }, quantity: 1 }]));
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
    renderAt("/dashboard/merchandise/order-merchandise", "order");

    fireEvent.click(await screen.findByRole("button", { name: "View cart" }));
    expect(screen.getByText("Placing an order holds the stock for you. Cancelling an unpaid order releases it.")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Review and continue" }));
    expect(screen.getByText(/Placing an order holds the stock for you\. You can cancel from My orders/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/does not reserve stock|reserved after payment|only after your payment is approved|has not reserved stock/);
  });

  it("drops the proof-pending line and Replace proof once an officer has verified the payment", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([
      buyerOrder({ id: 5, payment_method: "gcash", payment_proof_url: "proofs/5.jpg", payment_reference: "1234567890123" }),
      buyerOrder({ id: 6, payment_method: "gcash", payment_proof_url: "proofs/6.jpg", payment_reference: "1234567890124", officer_review_status: "approved" }),
    ]) });
    renderAt("/dashboard/merchandise/my-orders", "my-orders");

    await screen.findByText("ORD-6");
    expect(screen.getAllByText("Payment proof submitted and awaiting officer verification.")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Replace proof" })).toHaveLength(1);
    expect(screen.getByText("Payment verified: waiting for Admin approval")).toBeInTheDocument();
  });

  it("tells the buyer at checkout that the claim token appears after the Admin approves", async () => {
    localStorage.setItem("hiusa_student_cart", JSON.stringify([{ item: { ...products[0] }, quantity: 1 }]));
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
    renderAt("/dashboard/merchandise/order-merchandise", "order");

    fireEvent.click(await screen.findByRole("button", { name: "View cart" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review and continue" }));
    expect(screen.getByText(/claim token appears in My orders once the Admin approves the payment/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/officer verifies the payment, your claim token/);
  });

  it("names the chosen size on the checkout line", async () => {
    const sized = { ...products[0], variants: [{ id: 5, name: "M", stock_quantity: 4 }] };
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: [sized, products[1]], current_page: 1, last_page: 1 } });
    localStorage.setItem("hiusa_student_cart", JSON.stringify([{ item: { ...sized, merchandise_variant_id: 5, variant_name: "M", cart_key: "1:5" }, quantity: 1 }]));
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
    renderAt("/dashboard/merchandise/order-merchandise", "order");

    fireEvent.click(await screen.findByRole("button", { name: "View cart" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review and continue" }));
    expect(screen.getByText(/^M · Qty: 1 ×/)).toBeInTheDocument();
  });

  it("shows a refused order inline in the checkout modal and does not toast it", async () => {
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
    localStorage.setItem("hiusa_student_cart", JSON.stringify([{ item: { ...products[0] }, quantity: 1 }]));
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
    orderMocks.placeOrder.mockRejectedValue({ response: { status: 422, data: { message: "You already have 2 unpaid orders for this item." } } });
    renderAt("/dashboard/merchandise/order-merchandise", "order");

    fireEvent.click(await screen.findByRole("button", { name: "View cart" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review and continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Place reservation" }));

    const dialog = screen.getByRole("dialog", { name: "Confirm merchandise reservation" });
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("You already have 2 unpaid orders for this item.");
    expect(screen.getAllByText("You already have 2 unpaid orders for this item.")).toHaveLength(1);
  });

  it("shows a first-run orders state with a button to the shop", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
    renderAt("/dashboard/merchandise/my-orders", "my-orders");

    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Search orders" })).not.toBeInTheDocument();
    expect(screen.queryByText("Available items")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse the shop" }));
    expect(await screen.findByText("HIUSA Shirt")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard/merchandise/order-merchandise");
  });

  it("tells a buyer nothing is for sale yet when no item is active", async () => {
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1 } });
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
    renderAt("/dashboard/merchandise/order-merchandise", "order");

    expect(await screen.findByText("Nothing to buy yet")).toBeInTheDocument();
    expect(screen.getByText("Your officers add merchandise here.")).toBeInTheDocument();
  });

  it("confirms a checkout with what happens next and shows the same stage on the order row", async () => {
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
    localStorage.setItem("hiusa_student_cart", JSON.stringify([{ item: { ...products[0] }, quantity: 1 }]));
    const placed = buyerOrder({ id: 41 });
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
    orderMocks.placeOrder.mockImplementation(async () => {
      orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([placed]) });
      return { data: placed };
    });
    renderAt("/dashboard/merchandise/order-merchandise", "order");

    fireEvent.click(await screen.findByRole("button", { name: "View cart" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review and continue" }));
    expect(screen.getByText(/Next: your items are reserved\. Pay cash at pickup/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Place reservation" }));

    expect(await screen.findByText("ORD-41 reserved")).toBeInTheDocument();
    expect(screen.getByText(/Next: Pay cash at pickup\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/dashboard/merchandise/my-orders"));
    expect(progress(41)).toHaveAttribute("aria-valuetext", "Step 1 of 4: Reserved");
    expect(screen.getByText("Pay cash at pickup")).toBeInTheDocument();
  });
});

describe("MerchandisePage order stages for staff", () => {
  const staffOrder = (overrides) => buyerOrder({
    student: { school_id: 2200451, first_name: "Rafael", last_name: "Aquino", role: "STUDENT" },
    ...overrides,
  });
  const queue = (rows) => ({
    data: {
      ...paginatedOrders(rows),
      summary: { total_users: 1, purchased_users: 1, not_purchased_users: 0, purchase_rate: 100, paid_orders: 0, pending_orders: rows.length, claimed_orders: 0, unclaimed_orders: 0, total_collected: 0, outstanding_balance: 0, breakdown: [] },
      filter_options: { programs: [], majors: [], roles: [], positions: [], merchandise: products, statuses: [], payment_methods: [] },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("user", JSON.stringify({ school_id: 100002, role: "SBO_OFFICER" }));
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: products, current_page: 1, last_page: 1 } });
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
  });

  it("gives an officer the one action for each stage", async () => {
    orderMocks.getOrders.mockResolvedValue(queue([
      staffOrder({ id: 1, payment_method: "gcash", payment_proof_url: "proofs/1.jpg", payment_reference: "1234567890123" }),
      staffOrder({ id: 2 }),
      staffOrder({ id: 3, officer_review_status: "approved" }),
      staffOrder({ id: 4, status: "paid", claim_token: "CLAIMTOKEN123456", officer_review_status: "approved", admin_review_status: "approved" }),
      staffOrder({ id: 5, status: "claimed", claim_token: "CLAIMTOKEN654321", claimed_at: "2026-09-20T10:00:00Z" }),
      staffOrder({ id: 6, status: "cancelled" }),
    ]));
    renderAt("/dashboard/merchandise/manage-orders", "orders");

    expect((await screen.findAllByText("Verify the payment")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Collect the cash and verify the payment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Verified: waiting for Admin approval").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Release at the claim desk").length).toBeGreaterThan(0);
    expect(progress(1)).toHaveAttribute("aria-valuetext", "Step 2 of 4: Payment check");
    expect(progress(4)).toHaveAttribute("aria-valuetext", "Step 3 of 4: Paid");
    expect(progress(5)).toHaveAttribute("aria-valuetext", "Complete: 4 of 4 steps done");
    expect(screen.queryByRole("progressbar", { name: "ORD-6 progress" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Claim desk/ })[0]).toHaveAttribute("href", "/dashboard/merchandise/claim-tokens");
  });

  it("shows the stage and the next action inside each order row of the table", async () => {
    orderMocks.getOrders.mockResolvedValue(queue([
      staffOrder({ id: 2 }),
      staffOrder({ id: 4, status: "paid", claim_token: "CLAIMTOKEN123456", officer_review_status: "approved", admin_review_status: "approved" }),
      staffOrder({ id: 6, status: "cancelled" }),
    ]));
    renderAt("/dashboard/merchandise/manage-orders", "orders");

    const table = await screen.findByRole("table");
    const rowOf = (id) => within(table).getByRole("button", { name: `Actions for Order ${id}` }).closest("tr");
    expect(within(rowOf(2)).getByRole("progressbar", { name: "ORD-2 progress" })).toHaveAttribute("aria-valuetext", "Step 1 of 4: Reserved");
    expect(within(rowOf(2)).getByText("Collect the cash and verify the payment")).toBeInTheDocument();
    expect(within(rowOf(4)).getByRole("progressbar", { name: "ORD-4 progress" })).toHaveAttribute("aria-valuetext", "Step 3 of 4: Paid");
    expect(within(rowOf(4)).getByText("Release at the claim desk")).toBeInTheDocument();
    expect(within(rowOf(6)).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("asks the Admin to approve a payment the officer already verified", async () => {
    localStorage.setItem("user", JSON.stringify({ school_id: 100001, role: "ADMIN" }));
    orderMocks.getOrders.mockResolvedValue(queue([staffOrder({ id: 3, officer_review_status: "approved" })]));
    renderAt("/dashboard/merchandise/manage-orders", "orders");

    expect((await screen.findAllByText("Approve the verified payment")).length).toBeGreaterThan(0);
  });

  it("opens an order from ?record= with the stepper and the verify action", async () => {
    orderMocks.getOrders.mockResolvedValue(queue([staffOrder({ id: 2 })]));
    renderAt("/dashboard/merchandise/manage-orders?record=2", "orders");

    const dialog = await screen.findByRole("dialog", { name: "Merchandise order details" });
    expect(within(dialog).getByRole("list", { name: "ORD-2 progress" })).toBeInTheDocument();
    expect(within(dialog).getByText("Collect the cash and verify the payment")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Verify payment" }));
    expect(screen.getByRole("dialog", { name: "Verify merchandise payment" })).toBeInTheDocument();
  });

  it("reads an order that is not on the loaded page by its id and closes it", async () => {
    const far = staffOrder({ id: 99, status: "paid", claim_token: "CLAIMTOKEN123456" });
    orderMocks.getOrders.mockResolvedValue(queue([staffOrder({ id: 2 })]));
    orderMocks.getOrder.mockResolvedValue({ data: far });
    renderAt("/dashboard/merchandise/manage-orders?record=99", "orders");

    const dialog = await screen.findByRole("dialog", { name: "Merchandise order details" });
    expect(within(dialog).getByText("Release at the claim desk")).toBeInTheDocument();
    expect(orderMocks.getOrder).toHaveBeenCalledWith("99");
    expect(orderMocks.getOrders).not.toHaveBeenCalledWith(expect.objectContaining({ search: "99" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Close order details" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).not.toHaveTextContent("record=");
  });

  it("fits the order table to seven columns and keeps the folded details in the order drawer", async () => {
    orderMocks.getOrders.mockResolvedValue(queue([
      staffOrder({
        id: 8,
        status: "claimed",
        claim_token: "CLAIMTOKEN778899",
        claimed_at: "2026-09-20T10:00:00Z",
        claim_verifier: { first_name: "Lia", last_name: "Mercado" },
        student: { school_id: 2200451, first_name: "Rafael", last_name: "Aquino", role: "SBO_OFFICER", position_title: "Treasurer", program: "BSIT", year_level: "3", section: "A" },
      }),
    ]));
    renderAt("/dashboard/merchandise/manage-orders", "orders");

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual(["Order", "Student / User", "Item", "Total", "Mode of payment", "Fulfillment", "Actions"]);
    expect(table.className).not.toMatch(/min-w-\[/);
    expect(table.parentElement.className).not.toMatch(/overflow-x-auto/);
    expect(within(table).queryByText("Officer: Pending")).not.toBeInTheDocument();
    expect(within(table).queryByText(/Released by/)).not.toBeInTheDocument();
    expect(within(table).queryByText("CLAIMTOKEN778899")).not.toBeInTheDocument();

    fireEvent.click(within(table).getByRole("button", { name: "Actions for Order 8" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Review order" }));
    const dialog = await screen.findByRole("dialog", { name: "Merchandise order details" });
    const folded = within(dialog).getByRole("region", { name: "Order fulfillment details" });
    expect(within(folded).getByText("SBO OFFICER · Treasurer")).toBeInTheDocument();
    expect(within(folded).getByText("Apparel")).toBeInTheDocument();
    expect(within(folded).getByText("CLAIMTOKEN778899")).toBeInTheDocument();
    expect(within(folded).getByText("Lia Mercado")).toBeInTheDocument();
  });

  it("shows a first-run orders state and a filtered one that clears", async () => {
    orderMocks.getOrders.mockResolvedValue(queue([]));
    renderAt("/dashboard/merchandise/manage-orders", "orders");

    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByText("Orders appear here when students check out from the Shop.")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "Filter orders by status" })).getByRole("button", { name: "Claimed" }));
    expect(await screen.findByText("No orders match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getByText("No orders yet")).toBeInTheDocument());
  });
});

describe("MerchandisePage inventory guidance and the Claim desk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("user", JSON.stringify({ school_id: 100001, role: "ADMIN" }));
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: [products[0]], current_page: 1, last_page: 1 } });
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders() });
  });

  it("points the Admin to GCash setup when no QR is uploaded and opens the settings in place", async () => {
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");

    expect(await screen.findByText("Set up GCash so students can pay online")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up GCash" }));
    expect(screen.getByRole("dialog", { name: "GCash payment settings" })).toBeInTheDocument();
  });

  it("drops the GCash step as soon as the QR is saved from the settings dialog", async () => {
    merchandiseMocks.uploadGcashQr.mockResolvedValue({ data: { gcash_qr_url: "/storage/official-qr.png" } });
    const OriginalURL = globalThis.URL;
    vi.stubGlobal("URL", class extends OriginalURL {
      static createObjectURL() { return "blob:gcash-preview"; }
      static revokeObjectURL() {}
    });
    try {
      renderAt("/dashboard/merchandise/manage-inventory", "inventory");
      fireEvent.click(await screen.findByRole("button", { name: "Set up GCash" }));
      const dialog = screen.getByRole("dialog", { name: "GCash payment settings" });
      const qr = new File(["qr-image"], "official-qr.png", { type: "image/png" });
      fireEvent.change(await within(dialog).findByLabelText("Official GCash QR image"), { target: { files: [qr] } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Save GCash QR" }));

      await waitFor(() => expect(screen.queryByText("Set up GCash so students can pay online")).not.toBeInTheDocument());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops the GCash step once a QR exists", async () => {
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: "/storage/qr.png" } });
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");

    await screen.findAllByText("HIUSA Shirt");
    await waitFor(() => expect(merchandiseMocks.getGcashSettings).toHaveBeenCalled());
    expect(screen.queryByText("Set up GCash so students can pay online")).not.toBeInTheDocument();
  });

  it("warns when an active item is out of stock and offers to add stock", async () => {
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: products, current_page: 1, last_page: 1 } });
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: "/storage/qr.png" } });
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");

    expect(await screen.findByText("1 item is out of stock")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const filled = screen.getAllByRole("button").filter((button) => button.className.includes("bg-brand-700"));
    expect(filled.map((button) => button.textContent)).toEqual(["Add product"]);
    fireEvent.click(screen.getByRole("button", { name: "Add stock" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("HIUSA Lanyard");
  });

  it("labels the stock field as what can still be ordered", async () => {
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");

    fireEvent.click(await findRowAction("Edit"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Available to order")).toBeInTheDocument();
    expect(within(dialog).getByText("Units held by unpaid orders are already taken out.")).toBeInTheDocument();
  });

  it("refuses a PDF as the product image with a plain message and shows no preview", async () => {
    const OriginalURL = globalThis.URL;
    vi.stubGlobal("URL", class extends OriginalURL {
      static createObjectURL() { return "blob:product-preview"; }
      static revokeObjectURL() {}
    });
    try {
      renderAt("/dashboard/merchandise/manage-inventory", "inventory");
      fireEvent.click(await screen.findByRole("button", { name: "Add product" }));
      const dialog = await screen.findByRole("dialog");
      const picker = dialog.querySelector('input[type="file"]');
      fireEvent.change(picker, { target: { files: [new File(["%PDF"], "price-list.pdf", { type: "application/pdf" })] } });
      expect(within(dialog).getByRole("alert")).toHaveTextContent("That file is not an image. Choose a JPG, PNG or WebP picture.");
      expect(within(dialog).queryByAltText("Preview")).not.toBeInTheDocument();
      fireEvent.change(picker, { target: { files: [new File(["x"], "shirt.png", { type: "image/png" })] } });
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(dialog).getByAltText("Preview")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("asks for the price and stock before sizes and promotions, and explains a stock that follows the sizes", async () => {
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");
    fireEvent.click(await screen.findByRole("button", { name: "Add product" }));
    const dialog = await screen.findByRole("dialog");

    const text = dialog.textContent;
    const before = (first, second) => {
      expect(text.indexOf(first)).toBeGreaterThan(-1);
      expect(text.indexOf(first)).toBeLessThan(text.indexOf(second));
    };
    before("Category", "Unit price");
    before("Available to order", "Sizes and variants");
    before("Sizes and variants", "Promo price");
    expect(within(dialog).getByLabelText("Available to order")).not.toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Add variant" }));
    fireEvent.change(within(dialog).getByLabelText("Variant 1 stock"), { target: { value: "6" } });
    const stock = within(dialog).getByLabelText("Available to order");
    expect(stock).toBeDisabled();
    expect(stock).toHaveValue(6);
    expect(within(dialog).getByText("Added up from the sizes below.")).toBeInTheDocument();
  });

  it("asks only for a reason when a product without sizes is topped up with no reason", async () => {
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");
    fireEvent.click(await findRowAction("Add stock"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Enter a reason for this stock addition.")).toBeInTheDocument();
    expect(screen.queryByText(/Select a variant/)).not.toBeInTheDocument();
  });

  it("deletes an active item through the server rule", async () => {
    merchandiseMocks.deleteItem.mockResolvedValue({ data: { message: "Item deleted." } });
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");

    expect(await findRowAction("Delete HIUSA Shirt")).toBeInTheDocument();
    fireEvent.click(await findRowAction("Delete HIUSA Shirt"));
    const dialog = await screen.findByRole("dialog", { name: "Delete product" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(merchandiseMocks.deleteItem).toHaveBeenCalledWith(1));
    expect(await screen.findByText("HIUSA Shirt was deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete HIUSA Shirt" })).not.toBeInTheDocument();
  });

  it("keeps one primary action and a first-run state when there are no items", async () => {
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1 } });
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");

    expect(await screen.findByText("No items yet")).toBeInTheDocument();
    expect(screen.getByText("Add your first merchandise item so students can order it from the Shop.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add product" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add your first item" }));
    expect(screen.getByRole("dialog", { name: "Add merchandise product" })).toBeInTheDocument();
  });

  it("titles the validation page the Claim desk and describes an empty combined token list", async () => {
    renderAt("/dashboard/merchandise/claim-tokens", "tokens");

    expect(await screen.findByRole("heading", { level: 1, name: "Claim desk" })).toBeInTheDocument();
    expect(await screen.findByText("No claim tokens yet")).toBeInTheDocument();
    expect(screen.queryByText(/Validate/)).not.toBeInTheDocument();
  });

  it("names the claim desk table's last column Actions because it holds the row menu", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 12, status: "paid", claim_token: "CLAIMTOKEN000012", student: { school_id: 2200451, first_name: "Rafael", last_name: "Aquino" } })]) });
    renderAt("/dashboard/merchandise/claim-tokens", "tokens");

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers[headers.length - 1]).toBe("Actions");
    expect(within(table).queryByRole("columnheader", { name: "Details" })).not.toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Actions for Order 12" })).toBeInTheDocument();
  });

  it("does not print the buyer's claim token in the claim desk register", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 12, status: "paid", claim_token: "CLAIMTOKEN000012", student: { school_id: 2200451, first_name: "Rafael", last_name: "Aquino" } })]) });
    renderAt("/dashboard/merchandise/claim-tokens", "tokens");

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Rafael Aquino")).toBeInTheDocument();
    expect(within(table).getByText("Waiting to be claimed")).toBeInTheDocument();
    expect(within(table).queryByText("CLAIMTOKEN000012")).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  });
});

describe("MerchandisePage order queue reads", () => {
  const withProfile = (overrides) => buyerOrder({
    id: 2,
    student: { school_id: 2200451, first_name: "Rafael", last_name: "Aquino", role: "STUDENT", program: "BS Information Technology", year_level: "1st Year", section: "A" },
    transaction: { receipt_reference: "MERCH-ORD-2" },
    ...overrides,
  });
  const queue = (rows) => ({
    data: {
      ...paginatedOrders(rows),
      summary: { total_users: 1, purchased_users: 1, not_purchased_users: 0, purchase_rate: 100, paid_orders: 0, pending_orders: rows.length, claimed_orders: 0, unclaimed_orders: 0, total_collected: 0, outstanding_balance: 0, breakdown: [] },
      filter_options: { programs: [], majors: [], roles: [], positions: [], merchandise: products, statuses: [], payment_methods: [] },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("user", JSON.stringify({ school_id: 100002, role: "SBO_OFFICER" }));
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: products, current_page: 1, last_page: 1 } });
    merchandiseMocks.getGcashSettings.mockResolvedValue({ data: { gcash_qr_url: null } });
  });

  it("separates the school ID from the program, shows one order reference and names the payment method", async () => {
    orderMocks.getOrders.mockResolvedValue(queue([withProfile({ payment_method: "cash" })]));
    renderAt("/dashboard/merchandise/manage-orders", "orders");

    const table = await screen.findByRole("table");
    expect(within(table).getByText("2200451").parentElement).toHaveTextContent("2200451 · BS Information Technology · 1st Year · A");
    expect(within(table).getByText("2200451").parentElement).not.toHaveTextContent("Y1st");
    expect(within(table).getByText("ORD-2")).toBeInTheDocument();
    expect(within(table).queryByText("MERCH-ORD-2")).not.toBeInTheDocument();
    expect(within(table).getByText("Cash")).toBeInTheDocument();
    expect(within(table).queryByText("cash")).not.toBeInTheDocument();
  });

  it("leaves the payment cell and the row blank instead of printing placeholders when no method is chosen", async () => {
    orderMocks.getOrders.mockResolvedValue(queue([withProfile({ payment_method: null })]));
    renderAt("/dashboard/merchandise/manage-orders", "orders");

    await screen.findByRole("table");
    expect(screen.queryByText("Not selected")).not.toBeInTheDocument();
    expect(screen.queryByText("No method")).not.toBeInTheDocument();
    expect(screen.queryByText("Reference pending")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Officer: /)).not.toBeInTheDocument();
  });

  it("keeps the GCash reference note only for a GCash order and names the method", async () => {
    orderMocks.getOrders.mockResolvedValue(queue([withProfile({ payment_method: "gcash", payment_reference: null })]));
    renderAt("/dashboard/merchandise/manage-orders", "orders");

    const table = await screen.findByRole("table");
    expect(within(table).getByText("GCash")).toBeInTheDocument();
    expect(within(table).getByText("Reference pending")).toBeInTheDocument();
  });

  it("opens the GCash settings over the order queue when the page opens on the gcash tab", async () => {
    localStorage.setItem("user", JSON.stringify({ school_id: 100001, role: "ADMIN" }));
    orderMocks.getOrders.mockResolvedValue(queue([]));
    renderAt("/dashboard/merchandise/gcash-payment", "gcash");

    expect(await screen.findByRole("dialog", { name: "GCash payment settings" })).toBeInTheDocument();
    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
  });

  it("shows a hidden item as Not selling even when it is also low on stock", async () => {
    localStorage.setItem("user", JSON.stringify({ school_id: 100001, role: "ADMIN" }));
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: [{ ...products[0], is_active: false, is_low_stock: true }], current_page: 1, last_page: 1 } });
    orderMocks.getOrders.mockResolvedValue(queue([]));
    renderAt("/dashboard/merchandise/manage-inventory", "inventory");

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Not selling")).toBeInTheDocument();
    expect(within(table).queryByText("Low stock")).not.toBeInTheDocument();
  });

  it("shows the claim desk payment method with a capital letter", async () => {
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([buyerOrder({ id: 12, status: "paid", claim_token: "CLAIMTOKEN000012", payment_method: "cash", student: { school_id: 2200451, first_name: "Rafael", last_name: "Aquino" } })]) });
    renderAt("/dashboard/merchandise/claim-tokens", "tokens");

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Cash")).toBeInTheDocument();
    expect(within(table).queryByText("cash")).not.toBeInTheDocument();
  });
});
