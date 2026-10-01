import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MerchandisePage from "./MerchandisePage";

const merchandiseMocks = vi.hoisted(() => ({
  getMerchandise: vi.fn(),
  getGcashSettings: vi.fn(),
  uploadGcashQr: vi.fn(),
  adjustStock: vi.fn(),
  getMerchandiseAuditLogs: vi.fn(),
}));
const orderMocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
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
  deleteItem: vi.fn(),
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
    expect(screen.getByText("OUT OF STOCK")).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: "Cancel Order" }));
    expect(screen.getByRole("heading", { name: "Cancel this order?" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel Order" }).at(-1));

    await waitFor(() => expect(orderMocks.cancelOrder).toHaveBeenCalledWith(17));
    expect(await screen.findByText("Cancelled by buyer.")).toBeInTheDocument();
  });

  it("shows a limited promotion, requires a variant, and opens product images", async () => {
    merchandiseMocks.getMerchandise.mockResolvedValue({ data: { data: [{
      ...products[0], image_url: "/uploads/merchandise/shirt.jpg",
      variants: [{ id: 11, name: "XL", stock_quantity: 2, image_url: "/uploads/merchandise/xl.jpg" }],
      promotion_price: "250.00", effective_price: "250.00", promotion_buyer_limit: 100,
      promotion_remaining: 12, promotion_available_to_viewer: true, is_low_stock: true,
    }], current_page: 1, last_page: 1 } });
    render(<MemoryRouter><MerchandisePage initialTab="order" /></MemoryRouter>);
    expect(await screen.findByText("FIRST 100 BUYERS")).toBeInTheDocument();
    expect(screen.getByText("LOW STOCK")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(screen.getByText("Select a variant for HIUSA Shirt.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Select variant for HIUSA Shirt" }), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(screen.getByText(/1 x HIUSA Shirt added to cart/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View HIUSA Shirt images" }));
    expect(screen.getByRole("img", { name: "HIUSA Shirt image 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("img", { name: "HIUSA Shirt image 2" })).toBeInTheDocument();
  });

  it("opens My Cart from the metric and shows a printable claim ticket in My Orders", async () => {
    const paidOrder = { id: 29, merchandise: products[0], quantity: 1, total_price: "350.00", status: "paid", claim_token: "CLAIMTOKEN123456", created_at: "2026-09-13T10:00:00Z" };
    orderMocks.getOrders.mockResolvedValue({ data: paginatedOrders([paidOrder]) });
    render(<MemoryRouter><MerchandisePage initialTab="my-orders" /></MemoryRouter>);
    expect(await screen.findByText(/Merchandise claim ticket/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print ticket" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /My Cart/ }));
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
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

  it("loads only paid orders in the token validation queue", async () => {
    render(
      <MemoryRouter>
        <MerchandisePage initialTab="tokens" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Validate a claim token" })).toBeInTheDocument();
    expect(await screen.findByText("CLAIMTOKEN123456")).toBeInTheDocument();
    await waitFor(() =>
      expect(orderMocks.getOrders).toHaveBeenCalledWith(
        expect.objectContaining({ status: "paid", sort: "oldest" }),
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm Claim / Release" }));
    await waitFor(() => expect(orderMocks.claimByToken).toHaveBeenCalledWith(paidOrder.claim_token));
  });

  it("shows purchaser and order details before payment approval", async () => {
    const pendingOrder = { ...paidOrder, status: "pending", claim_token: null, unit_price: "250.00", total_price: "250.00", payment_method: "cash" };
    const response = managerOrdersResponse();
    response.data.data = [pendingOrder];
    orderMocks.getOrders.mockResolvedValue(response);
    render(<MemoryRouter><MerchandisePage initialTab="orders" /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole("button", { name: /^Approve/ }))[0]);
    expect(orderMocks.updateOrderStatus).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Verify merchandise payment" });
    expect(dialog).toHaveTextContent("Rafael Aquino");
    expect(dialog).toHaveTextContent("BS Information Technology");
    expect(dialog).toHaveTextContent("250.00");
    expect(dialog).toHaveTextContent("ORD-28");
  });

  it("shows inventory top sellers from paid sales and requires a stock note", async () => {
    const summary = managerOrdersResponse();
    summary.data.summary.breakdown = [{ id: 1, name: "HIUSA Shirt", quantity: 4, collected: 1400 }];
    orderMocks.getOrders.mockResolvedValue(summary);
    merchandiseMocks.adjustStock.mockResolvedValue({ data: { ...products[0], stock_quantity: 10 } });
    render(<MemoryRouter><MerchandisePage initialTab="inventory" /></MemoryRouter>);
    expect(await screen.findByText("Top sellers")).toBeInTheDocument();
    expect(await screen.findByText(/1,400\.00 collected/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Add Stock" })[0]);
    fireEvent.change(screen.getByPlaceholderText("e.g. New delivery received"), { target: { value: "New delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add Stock" }).at(-1));
    await waitFor(() => expect(merchandiseMocks.adjustStock).toHaveBeenCalledWith(1, 1, "New delivery", null));
  });
});
