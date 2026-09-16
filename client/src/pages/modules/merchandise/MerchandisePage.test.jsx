import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MerchandisePage from "./MerchandisePage";

const merchandiseMocks = vi.hoisted(() => ({
  getMerchandise: vi.fn(),
  getGcashSettings: vi.fn(),
}));
const orderMocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
  cancelOrder: vi.fn(),
}));

vi.mock("../../../services/merchandiseService", () => ({
  ...merchandiseMocks,
  createItem: vi.fn(),
  updateItem: vi.fn(),
  adjustStock: vi.fn(),
  deleteItem: vi.fn(),
}));

vi.mock("../../../services/orderService", () => ({
  ...orderMocks,
  exportOrders: vi.fn(),
  getOrderAnalyticsUsers: vi.fn(),
  getOrderAuditLogs: vi.fn(),
  openOrderPaymentProof: vi.fn(),
  placeOrder: vi.fn(),
  submitOrderPayment: vi.fn(),
  updateOrderStatus: vi.fn(),
  claimByToken: vi.fn(),
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
    expect(screen.getByText("0 in stock")).toBeInTheDocument();
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
  });

  it("shows an approved order's claim token in the modern order queue", async () => {
    render(
      <MemoryRouter>
        <MerchandisePage initialTab="orders" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Manage Orders" })).toBeInTheDocument();
    expect(screen.getAllByText("Ready for pickup").length).toBeGreaterThan(0);
    expect((await screen.findAllByText("CLAIMTOKEN123456")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rafael Aquino").length).toBeGreaterThan(0);
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
});
