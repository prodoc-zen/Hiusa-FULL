<?php

namespace App\Http\Controllers;

use App\Models\FinancialForecast;
use Illuminate\Http\Request;

class FinancialForecastController extends Controller
{
    public function index()
    {
        return response()->json(
            FinancialForecast::orderBy('forecast_period', 'asc')->get()
        );
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'forecast_period'    => ['required', 'string', 'max:100'],
            'predicted_income'   => ['required', 'numeric', 'min:0'],
            'predicted_expense'  => ['required', 'numeric', 'min:0'],
            'confidence_note'    => ['nullable', 'string'],
        ]);

        $forecast = FinancialForecast::create($data);

        return response()->json($forecast, 201);
    }

    public function update(Request $request, $id)
    {
        $forecast = FinancialForecast::find($id);

        if (!$forecast) {
            return response()->json(['message' => 'Forecast not found.'], 404);
        }

        $data = $request->validate([
            'forecast_period'   => ['sometimes', 'required', 'string', 'max:100'],
            'predicted_income'  => ['sometimes', 'required', 'numeric', 'min:0'],
            'predicted_expense' => ['sometimes', 'required', 'numeric', 'min:0'],
            'confidence_note'   => ['nullable', 'string'],
        ]);

        $forecast->update($data);

        return response()->json($forecast->fresh());
    }

    public function destroy($id)
    {
        $forecast = FinancialForecast::find($id);

        if (!$forecast) {
            return response()->json(['message' => 'Forecast not found.'], 404);
        }

        $forecast->delete();

        return response()->json(['message' => 'Forecast deleted successfully.']);
    }
}
